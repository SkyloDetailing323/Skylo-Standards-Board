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

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const blue = "#009cff";
const bg   = "#ffffff";
const card = "#f4f8fd";
const bord = "#d0e8ff";
const dark = "#0a1a2e";
const muted = "#6b8aaa";
const ADMIN_PIN = "0000";
const UPSELL_PTS_PER_DOLLAR = 0.5; // $2 = 1 point
const REVIEW_PTS = 25;             // per 5-star review
const REVIEW_BONUS_PTS = 75;       // bonus for 10+ reviews in a month

const LOGO_SRC = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 50'%3E%3Crect width='200' height='50' fill='%23009cff' rx='4'/%3E%3Ctext x='100' y='34' font-family='monospace' font-size='22' font-weight='900' fill='white' text-anchor='middle'%3ESKYLO%3C/text%3E%3C/svg%3E";

// ─── BADGE DEFS ───────────────────────────────────────────────────────────────
const BADGE_DEFS = [
  { id:"day_one",         cat:"Tenure",      name:"Day One",           icon:"🔑", pts:50,   desc:"Completed first day on the job" },
  { id:"thirty_days",    cat:"Tenure",      name:"30-Day Survivor",   icon:"📅", pts:100,  desc:"First 30 days completed" },
  { id:"ninety_days",    cat:"Tenure",      name:"Quarter Strong",    icon:"📆", pts:200,  desc:"90 days on the team" },
  { id:"one_year",       cat:"Tenure",      name:"One Year Legend",   icon:"🏅", pts:500,  desc:"First full year — booklet unlocked" },
  { id:"two_year",       cat:"Tenure",      name:"Two Year Veteran",  icon:"🎖️", pts:750,  desc:"Two years of excellence" },
  { id:"five_year",      cat:"Tenure",      name:"Five Year Elite",   icon:"👑", pts:1500, desc:"Five years — rare and honored" },
  { id:"zero_callback",  cat:"Performance", name:"Zero Callbacks",    icon:"✅", pts:300,  desc:"Month with zero callbacks" },
  { id:"clean_streak",   cat:"Performance", name:"Clean Streak",      icon:"🔥", pts:600,  desc:"3 months straight, no callbacks" },
  { id:"five_star",      cat:"Performance", name:"5-Star Tech",       icon:"⭐", pts:150,  desc:"First 5-star customer review" },
  { id:"review_machine", cat:"Performance", name:"Review Machine",    icon:"🌟", pts:400,  desc:"10 five-star reviews earned" },
  { id:"most_booked",    cat:"Performance", name:"Most Booked",       icon:"📈", pts:350,  desc:"Top revenue tech of the month" },
  { id:"certified",      cat:"Skills",      name:"Certified",         icon:"📜", pts:250,  desc:"First certification earned" },
  { id:"double_cert",    cat:"Skills",      name:"Double Certified",  icon:"🎓", pts:400,  desc:"Two certifications completed" },
  { id:"multi_trade",    cat:"Skills",      name:"Multi-Trade",       icon:"🛠️", pts:500,  desc:"Trained in more than one trade" },
  { id:"mentor",         cat:"Skills",      name:"Mentor",            icon:"🤝", pts:450,  desc:"Trained or onboarded a new tech" },
  { id:"never_late",     cat:"Character",   name:"Never Late",        icon:"⏰", pts:200,  desc:"Perfect punctuality all quarter" },
  { id:"safety_first",   cat:"Character",   name:"Safety First",      icon:"🦺", pts:100,  desc:"Proactive safety report" },
  { id:"problem_solver", cat:"Character",   name:"Problem Solver",    icon:"💡", pts:300,  desc:"Idea adopted by the team" },
  { id:"team_player",    cat:"Character",   name:"Team Player",       icon:"🫂", pts:150,  desc:"Covered for a teammate" },
  { id:"culture_carrier",cat:"Character",   name:"Culture Carrier",   icon:"🏆", pts:500,  desc:"Peer-nominated quarterly" },
];
const BADGE_MAP = Object.fromEntries(BADGE_DEFS.map(b => [b.id, b]));

// ─── SERVICE PLANS (updated pts based on LTV math) ────────────────────────────
const SERVICE_PLANS = [
  { id:"biannual",  label:"Bi-Annual",  freq:"2x/year",        value:2,  pts:25,  ltv_yr:635  },
  { id:"quarterly", label:"Quarterly",  freq:"4x/year",        value:4,  pts:75,  ltv_yr:1030 },
  { id:"bimonthly", label:"Bi-Monthly", freq:"Every 2 months", value:6,  pts:120, ltv_yr:1425 },
  { id:"monthly",   label:"Monthly",    freq:"12x/year",       value:12, pts:200, ltv_yr:2610 },
  { id:"biweekly",  label:"Bi-Weekly",  freq:"Every 2 weeks",  value:26, pts:280, ltv_yr:3900 },
  { id:"weekly",    label:"Weekly",     freq:"52x/year",       value:52, pts:350, ltv_yr:5850 },
];
const PLAN_MAP = Object.fromEntries(SERVICE_PLANS.map(p => [p.id, p]));
const PLAN_COLORS = { biannual:"#10b981", quarterly:"#3b82f6", bimonthly:"#8b5cf6", monthly:"#009cff", biweekly:"#f59e0b", weekly:"#ef4444" };

// ─── JOURNEY TIERS (calibrated to ~800 pts/month earn rate) ──────────────────
const JOURNEY_TIERS = [
  {
    id:"bronze", name:"Bronze", icon:"🥉", minPts:0, maxPts:1599,
    color:"#cd7f32", bg:"linear-gradient(135deg,#2a1400,#5a3010)",
    glow:"#cd7f3255",
    desc:"Every legend starts here. You're in the door — now prove it.",
    reward:"Tier 1 Rewards ($150)", rewardPts:1600,
    perks:["$150 reward eligibility","Weekly upsell tracking","Badge earning unlocked"],
  },
  {
    id:"silver", name:"Silver", icon:"🥈", minPts:1600, maxPts:3199,
    color:"#a8c0d6", bg:"linear-gradient(135deg,#0e1f2e,#1a3a58)",
    glow:"#a8c0d655",
    desc:"You're building something real. The team is noticing.",
    reward:"Tier 2 Rewards ($300)", rewardPts:3200,
    perks:["$300 reward eligibility","Switchover bonus tracking","Monthly performance spotlight"],
  },
  {
    id:"gold", name:"Gold", icon:"🥇", minPts:3200, maxPts:5999,
    color:"#f5c542", bg:"linear-gradient(135deg,#1e1400,#3d2d00)",
    glow:"#f5c54255",
    desc:"Elite territory. You're carrying the standard for the whole crew.",
    reward:"Tier 3 Rewards ($600)", rewardPts:6000,
    perks:["$600 reward eligibility","Featured on team board","Priority scheduling pick"],
  },
  {
    id:"platinum", name:"Platinum", icon:"💎", minPts:6000, maxPts:11999,
    color:"#c4b5fd", bg:"linear-gradient(135deg,#0d0520,#1e0a40)",
    glow:"#c4b5fd55",
    desc:"You've reached the top tier. This is what Skylo Standard looks like.",
    reward:"Tier 4 Rewards ($1,200)", rewardPts:12000,
    perks:["$1,200 reward eligibility","Skylo Legend nomination","Annual recognition award"],
  },
  {
    id:"legend", name:"Legend", icon:"👑", minPts:12000, maxPts:Infinity,
    color:"#fbbf24", bg:"linear-gradient(135deg,#1a1000,#3d2900)",
    glow:"#fbbf2455",
    desc:"One of one. You've set the standard for everyone who comes after you.",
    reward:"Uncapped — choose your reward", rewardPts:null,
    perks:["All rewards unlocked","Permanent hall of fame","Custom perk negotiation"],
  },
];
function getTier(pts) { return [...JOURNEY_TIERS].reverse().find(t => pts >= t.minPts) || JOURNEY_TIERS[0]; }

const SEED_TECHS = [
  { name:"Max Hancock",    pin:"1111", avatar:"MH", badges:["day_one"], start_date: null },
  { name:"Milos Lewit",    pin:"1112", avatar:"ML", badges:["day_one"], start_date: null },
  { name:"Kade Andrew",    pin:"1113", avatar:"KA", badges:["day_one"], start_date: null },
  { name:"Riley Lyon",     pin:"1114", avatar:"RL", badges:["day_one"], start_date: null },
  { name:"Caleb McDaniel", pin:"1115", avatar:"CM", badges:["day_one"], start_date: null },
  { name:"Will Faulkner",  pin:"1116", avatar:"WF", badges:["day_one"], start_date: null },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const calcPoints = (badges) => (badges || []).reduce((s, id) => s + (BADGE_MAP[id]?.pts || 0), 0);
const medal = (i) => i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`;

function getWeekKey() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());
  return `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,"0")}-${String(start.getDate()).padStart(2,"0")}`;
}
function getMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
}
function formatWeekLabel(key) {
  const d = new Date(key + "T00:00:00");
  const end = new Date(d); end.setDate(d.getDate()+6);
  const fmt = (dt) => dt.toLocaleDateString("en-US",{month:"short",day:"numeric"});
  return `${fmt(d)} – ${fmt(end)}`;
}
function formatMonthLabel(key) {
  const [y, m] = key.split("-");
  return new Date(y, m-1).toLocaleDateString("en-US",{month:"long",year:"numeric"});
}
function formatTenure(startDate) {
  if (!startDate) return "—";
  const start = new Date(startDate);
  const now = new Date();
  const days = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days/30)}mo ${days%30}d`;
  const yrs = Math.floor(days/365);
  const mos = Math.floor((days % 365) / 30);
  return mos > 0 ? `${yrs}yr ${mos}mo` : `${yrs}yr`;
}

function calcTechTotals(tech, upsells, switchovers, reviews) {
  const badgePts = calcPoints(tech.badges);
  const upsellAmt = upsells.filter(u => u.tech_id === tech.id).reduce((s,u) => s+u.amount, 0);
  const upsellPts = Math.round(upsellAmt * UPSELL_PTS_PER_DOLLAR);
  const switchPts = switchovers.filter(s => s.tech_id === tech.id).reduce((s,sw) => s+(PLAN_MAP[sw.plan_id]?.pts||0), 0);
  // review pts: 25 per review + 75 bonus per month with 10+
  const reviewsByMonth = {};
  reviews.filter(r => r.tech_id === tech.id).forEach(r => {
    reviewsByMonth[r.month_key] = (reviewsByMonth[r.month_key]||0) + r.count;
  });
  const reviewPts = Object.values(reviewsByMonth).reduce((s,cnt) => {
    return s + (cnt * REVIEW_PTS) + (cnt >= 10 ? REVIEW_BONUS_PTS : 0);
  }, 0);
  const total = badgePts + upsellPts + switchPts + reviewPts;
  return { badgePts, upsellAmt, upsellPts, switchPts, reviewPts, total };
}

// ─── COMPONENTS ───────────────────────────────────────────────────────────────
function Logo({ height=44 }) {
  return <img src={LOGO_SRC} alt="Skylo" style={{ height:`${height}px`, objectFit:"contain" }} />;
}
function Header({ right, title }) {
  return (
    <div style={{ background:"#fff", borderBottom:`1px solid ${bord}`, padding:"14px 24px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
      <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
        <Logo height={36} />
        {title && <span style={{ fontWeight:"800", fontSize:"15px", color:dark }}>{title}</span>}
      </div>
      {right}
    </div>
  );
}
function LogoutBtn({ onLogout }) {
  return <button onClick={onLogout} style={{ background:"none", border:`1px solid ${bord}`, color:muted, padding:"6px 14px", borderRadius:"6px", cursor:"pointer", fontSize:"12px", fontFamily:"monospace" }}>LOG OUT</button>;
}
function TabBar({ tabs, active, setActive, accentColor }) {
  const ac = accentColor || blue;
  return (
    <div style={{ display:"flex", borderBottom:`1px solid ${bord}`, background:"#fff", padding:"0 12px", overflowX:"auto", WebkitOverflowScrolling:"touch", scrollbarWidth:"none" }}>
      {tabs.map(([id,label]) => (
        <button key={id} onClick={() => setActive(id)} style={{
          background:"none", border:"none", cursor:"pointer", whiteSpace:"nowrap",
          padding:"12px 14px", fontSize:"11px", letterSpacing:"0.5px", textTransform:"uppercase",
          fontFamily:"monospace", color: active===id ? ac : muted, flexShrink:0,
          borderBottom: active===id ? `2px solid ${ac}` : "2px solid transparent",
        }}>{label}</button>
      ))}
    </div>
  );
}
function StatCard({ label, value, color, sub }) {
  return (
    <div style={{ background:card, border:`1px solid ${bord}`, borderRadius:"8px", padding:"18px" }}>
      <div style={{ fontSize:"10px", color:muted, letterSpacing:"2px", textTransform:"uppercase", fontFamily:"monospace", marginBottom:"8px" }}>{label}</div>
      <div style={{ fontSize:"26px", fontWeight:"900", color: color||dark }}>{value}</div>
      {sub && <div style={{ fontSize:"11px", color:muted, fontFamily:"monospace", marginTop:"4px" }}>{sub}</div>}
    </div>
  );
}

// ─── PIN PAD ──────────────────────────────────────────────────────────────────
function PinPad({ onSubmit }) {
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);
  useEffect(() => {
    if (pin.length === 4) {
      const ok = onSubmit(pin);
      if (!ok) { setShake(true); setTimeout(() => { setShake(false); setPin(""); }, 600); }
    }
  }, [pin]);
  const press = (d) => { if (pin.length < 4) setPin(p => p+d); };
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"28px" }}>
      <div style={{ fontSize:"12px", letterSpacing:"3px", color:muted, textTransform:"uppercase", fontFamily:"monospace" }}>Enter PIN</div>
      <div style={{ display:"flex", gap:"16px", animation: shake?"shake 0.4s ease":"none" }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{ width:"16px", height:"16px", borderRadius:"50%", background: i<pin.length?blue:"transparent", border:`2px solid ${i<pin.length?blue:bord}`, transition:"all 0.15s" }} />
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 70px)", gap:"10px" }}>
        {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((d,i) => (
          <button key={i} onClick={() => d==="⌫"?setPin(p=>p.slice(0,-1)):d!==""?press(String(d)):null}
            disabled={d===""} style={{ width:"70px", height:"70px", borderRadius:"8px", background:d===""?"transparent":card, border:d===""?"none":`1px solid ${bord}`, color:d==="⌫"?muted:dark, fontSize:d==="⌫"?"18px":"20px", fontWeight:"600", cursor:d===""?"default":"pointer", fontFamily:"monospace" }}>
            {d}
          </button>
        ))}
      </div>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>
    </div>
  );
}

// ─── BADGE GRID ───────────────────────────────────────────────────────────────
function BadgeGrid({ earned }) {
  return (
    <div>
      {["Tenure","Performance","Skills","Character"].map(cat => (
        <div key={cat} style={{ marginBottom:"28px" }}>
          <div style={{ fontSize:"11px", letterSpacing:"3px", color:blue, fontFamily:"monospace", textTransform:"uppercase", marginBottom:"10px" }}>{cat}</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(190px,1fr))", gap:"10px" }}>
            {BADGE_DEFS.filter(b => b.cat===cat).map(b => {
              const has = earned.includes(b.id);
              return (
                <div key={b.id} style={{ background:has?"#e6f4ff":card, border:`1px solid ${has?blue+"55":bord}`, borderRadius:"8px", padding:"14px", opacity:has?1:0.45, position:"relative" }}>
                  {!has && <div style={{ position:"absolute", top:"10px", right:"10px", fontSize:"11px" }}>🔒</div>}
                  <div style={{ fontSize:"22px", marginBottom:"6px" }}>{b.icon}</div>
                  <div style={{ fontWeight:"700", fontSize:"13px", color:dark, marginBottom:"3px" }}>{b.name}</div>
                  <div style={{ fontSize:"11px", color:muted, marginBottom:"6px" }}>{b.desc}</div>
                  <div style={{ fontSize:"11px", fontFamily:"monospace", color:has?blue:muted }}>+{b.pts} pts</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── UPSELL LEADERBOARD ───────────────────────────────────────────────────────
function UpsellLeaderboard({ techs, upsells, currentId }) {
  const wk = getWeekKey();
  const byWeek = {};
  upsells.forEach(u => {
    if (!byWeek[u.week_key]) byWeek[u.week_key] = {};
    byWeek[u.week_key][u.tech_id] = (byWeek[u.week_key][u.tech_id]||0) + u.amount;
  });
  const allWeeks = Object.keys(byWeek).sort((a,b) => b.localeCompare(a));
  const wkData = byWeek[wk]||{};
  const allTimeTotals = {};
  upsells.forEach(u => { allTimeTotals[u.tech_id]=(allTimeTotals[u.tech_id]||0)+u.amount; });
  const ranked = [...techs].map(t => ({...t, thisWeek:wkData[t.id]||0, allTime:allTimeTotals[t.id]||0})).sort((a,b)=>b.thisWeek-a.thisWeek);
  const top = ranked[0]?.thisWeek||1;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"20px" }}>
      <div style={{ background:"linear-gradient(135deg,#e6f4ff,#f0f9ff)", border:`1px solid ${blue}44`, borderRadius:"10px", padding:"16px 20px" }}>
        <div style={{ fontSize:"11px", letterSpacing:"3px", color:blue, fontFamily:"monospace", textTransform:"uppercase", marginBottom:"12px" }}>💰 All-Time Upsell Totals</div>
        {[...techs].sort((a,b)=>(allTimeTotals[b.id]||0)-(allTimeTotals[a.id]||0)).map((t,i)=>{
          const amt=allTimeTotals[t.id]||0; const topAmt=Math.max(...techs.map(x=>allTimeTotals[x.id]||0))||1; const pct=Math.round((amt/topAmt)*100);
          return (
            <div key={t.id} style={{ marginBottom:"8px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"3px" }}>
                <span style={{ fontSize:"13px", fontWeight:t.id===currentId?"800":"600", color:t.id===currentId?blue:dark }}>{medal(i)} {t.name}{t.id===currentId?" (you)":""}</span>
                <span style={{ fontFamily:"monospace", fontWeight:"700", fontSize:"13px", color:dark }}>${amt.toLocaleString()}</span>
              </div>
              <div style={{ background:bord, borderRadius:"3px", height:"4px", overflow:"hidden" }}>
                <div style={{ width:`${pct}%`, height:"100%", background:`linear-gradient(90deg,${blue},#0066cc)`, borderRadius:"3px" }} />
              </div>
            </div>
          );
        })}
      </div>
      <div>
        <div style={{ fontSize:"11px", letterSpacing:"3px", color:blue, fontFamily:"monospace", textTransform:"uppercase", marginBottom:"12px" }}>This Week · {formatWeekLabel(wk)}</div>
        <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
          {ranked.map((t,idx)=>{
            const isMe=t.id===currentId; const pct=top>0?Math.round((t.thisWeek/top)*100):0;
            return (
              <div key={t.id} style={{ background:isMe?"#e6f4ff":card, border:`1px solid ${isMe?blue:bord}`, borderRadius:"10px", padding:"16px 18px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"14px", marginBottom:"10px" }}>
                  <div style={{ width:"30px", textAlign:"center", fontSize:idx<3?"20px":"13px", color:muted, fontFamily:"monospace", fontWeight:"700" }}>{medal(idx)}</div>
                  <div style={{ width:"40px", height:"40px", borderRadius:"50%", background:`${blue}22`, border:`1px solid ${blue}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"12px", fontWeight:"700", color:blue, fontFamily:"monospace", flexShrink:0 }}>{t.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:"700", fontSize:"15px", color:dark }}>{t.name}{isMe&&<span style={{ fontSize:"10px", color:blue, fontFamily:"monospace" }}> YOU</span>}</div>
                    <div style={{ fontSize:"12px", color:muted, fontFamily:"monospace" }}>All-time: ${t.allTime.toLocaleString()} · {Math.round(t.allTime*UPSELL_PTS_PER_DOLLAR).toLocaleString()} pts</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:"22px", fontWeight:"900", color:t.thisWeek>0?dark:bord }}>${t.thisWeek.toLocaleString()}</div>
                    <div style={{ fontSize:"11px", color:blue, fontFamily:"monospace" }}>+{Math.round(t.thisWeek*UPSELL_PTS_PER_DOLLAR)} pts</div>
                  </div>
                </div>
                <div style={{ background:bord, borderRadius:"4px", height:"5px", overflow:"hidden" }}>
                  <div style={{ width:`${pct}%`, height:"100%", background:`linear-gradient(90deg,${blue},#0066cc)`, borderRadius:"4px" }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {allWeeks.length>0&&(
        <div>
          <div style={{ fontSize:"11px", letterSpacing:"3px", color:blue, fontFamily:"monospace", textTransform:"uppercase", marginBottom:"12px" }}>Weekly History</div>
          <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
            {allWeeks.map(w=>{
              const d=byWeek[w]||{}; const rows=[...techs].map(t=>({...t,amt:d[t.id]||0})).filter(t=>t.amt>0).sort((a,b)=>b.amt-a.amt); const total=rows.reduce((s,t)=>s+t.amt,0);
              return (
                <div key={w} style={{ background:card, border:`1px solid ${w===wk?blue:bord}`, borderRadius:"10px", overflow:"hidden" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 16px", borderBottom:`1px solid ${bord}`, background:w===wk?"#e6f4ff":"#eef6ff" }}>
                    <div style={{ fontWeight:"700", fontSize:"13px", color:dark }}>{formatWeekLabel(w)}{w===wk&&<span style={{ fontSize:"10px", color:blue, fontFamily:"monospace" }}> CURRENT</span>}</div>
                    <div style={{ fontFamily:"monospace", color:blue, fontWeight:"700", fontSize:"13px" }}>Total: ${total.toLocaleString()}</div>
                  </div>
                  <div style={{ padding:"10px 16px", display:"flex", flexDirection:"column", gap:"5px" }}>
                    {rows.map((t,i)=>(
                      <div key={t.id} style={{ display:"flex", justifyContent:"space-between" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:"6px" }}><span>{medal(i)}</span><span style={{ fontSize:"13px", color:dark }}>{t.name}</span></div>
                        <span style={{ fontFamily:"monospace", fontWeight:"700", fontSize:"13px", color:dark }}>${t.amt.toLocaleString()}</span>
                      </div>
                    ))}
                    {rows.length===0&&<div style={{ fontSize:"12px", color:muted }}>No data</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SWITCHOVER LEADERBOARD ───────────────────────────────────────────────────
function SwitchoverLeaderboard({ techs, switchovers, currentId }) {
  const [rankBy, setRankBy] = useState("count");
  const wk = getWeekKey();
  const byWeek = {};
  switchovers.forEach(s => {
    if (!byWeek[s.week_key]) byWeek[s.week_key]={};
    if (!byWeek[s.week_key][s.tech_id]) byWeek[s.week_key][s.tech_id]=[];
    byWeek[s.week_key][s.tech_id].push({plan:s.plan_id});
  });
  const allWeeks = Object.keys(byWeek).sort((a,b)=>b.localeCompare(a));
  const wkData = byWeek[wk]||{};
  const allTimeCount={}, allTimePts={};
  switchovers.forEach(s=>{allTimeCount[s.tech_id]=(allTimeCount[s.tech_id]||0)+1; allTimePts[s.tech_id]=(allTimePts[s.tech_id]||0)+(PLAN_MAP[s.plan_id]?.pts||0);});
  const ranked = [...techs].map(t=>{
    const entries=wkData[t.id]||[];
    return {...t, count:entries.length, pts:entries.reduce((s,e)=>s+(PLAN_MAP[e.plan]?.pts||0),0), allCount:allTimeCount[t.id]||0, allPts:allTimePts[t.id]||0, entries};
  }).sort((a,b)=>rankBy==="count"?b.count-a.count:b.pts-a.pts);
  const top=ranked[0]?.[rankBy==="count"?"count":"pts"]||1;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"20px" }}>
      <div style={{ background:"linear-gradient(135deg,#e6f4ff,#f0f9ff)", border:`1px solid ${blue}44`, borderRadius:"10px", padding:"16px 20px" }}>
        <div style={{ fontSize:"11px", letterSpacing:"3px", color:blue, fontFamily:"monospace", textTransform:"uppercase", marginBottom:"12px" }}>🔄 All-Time Switchover Totals</div>
        {[...techs].sort((a,b)=>(allTimePts[b.id]||0)-(allTimePts[a.id]||0)).map((t,i)=>(
          <div key={t.id} style={{ display:"flex", justifyContent:"space-between", marginBottom:"6px" }}>
            <span style={{ fontSize:"13px", fontWeight:t.id===currentId?"800":"600", color:t.id===currentId?blue:dark }}>{medal(i)} {t.name}{t.id===currentId?" (you)":""}</span>
            <span style={{ fontFamily:"monospace", fontSize:"13px", color:dark }}><strong>{allTimeCount[t.id]||0}</strong> converts · <strong>{(allTimePts[t.id]||0).toLocaleString()}</strong> pts</span>
          </div>
        ))}
      </div>
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"12px" }}>
          <div style={{ fontSize:"11px", letterSpacing:"3px", color:blue, fontFamily:"monospace", textTransform:"uppercase" }}>This Week · {formatWeekLabel(wk)}</div>
          <div style={{ display:"flex", gap:"6px" }}>
            {[["count","# Converts"],["pts","Points"]].map(([id,label])=>(
              <button key={id} onClick={()=>setRankBy(id)} style={{ background:rankBy===id?blue:card, border:`1px solid ${rankBy===id?blue:bord}`, color:rankBy===id?"#fff":muted, padding:"4px 10px", borderRadius:"4px", cursor:"pointer", fontSize:"11px", fontFamily:"monospace" }}>{label}</button>
            ))}
          </div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
          {ranked.map((t,idx)=>{
            const isMe=t.id===currentId; const val=rankBy==="count"?t.count:t.pts; const pct=top>0?Math.round((val/top)*100):0;
            return (
              <div key={t.id} style={{ background:isMe?"#e6f4ff":card, border:`1px solid ${isMe?blue:bord}`, borderRadius:"10px", padding:"16px 18px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"14px", marginBottom:"10px" }}>
                  <div style={{ width:"30px", textAlign:"center", fontSize:idx<3?"20px":"13px", color:muted, fontFamily:"monospace", fontWeight:"700" }}>{medal(idx)}</div>
                  <div style={{ width:"40px", height:"40px", borderRadius:"50%", background:`${blue}22`, border:`1px solid ${blue}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"12px", fontWeight:"700", color:blue, fontFamily:"monospace", flexShrink:0 }}>{t.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:"700", fontSize:"15px", color:dark }}>{t.name}{isMe&&<span style={{ fontSize:"10px", color:blue, fontFamily:"monospace" }}> YOU</span>}</div>
                    <div style={{ fontSize:"12px", color:muted, fontFamily:"monospace" }}>All-time: {t.allCount} converts · {t.allPts.toLocaleString()} pts</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:"22px", fontWeight:"900", color:t.count>0?dark:bord }}>{t.count}</div>
                    <div style={{ fontSize:"11px", color:blue, fontFamily:"monospace" }}>+{t.pts} pts</div>
                  </div>
                </div>
                <div style={{ background:bord, borderRadius:"4px", height:"5px", overflow:"hidden", marginBottom:t.entries.length>0?"10px":"0" }}>
                  <div style={{ width:`${pct}%`, height:"100%", background:`linear-gradient(90deg,${blue},#0066cc)`, borderRadius:"4px" }} />
                </div>
                {t.entries.length>0&&(
                  <div style={{ display:"flex", flexWrap:"wrap", gap:"5px" }}>
                    {t.entries.map((e,i)=>{const plan=PLAN_MAP[e.plan]; const pc=PLAN_COLORS[e.plan]||muted; return plan?(<div key={i} style={{ background:"#fff", border:`1px solid ${pc}44`, borderLeft:`3px solid ${pc}`, borderRadius:"4px", padding:"2px 8px", fontSize:"11px", color:dark, fontFamily:"monospace" }}>{plan.label} · +{plan.pts}pts</div>):null;})}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ background:card, border:`1px solid ${bord}`, borderRadius:"8px", padding:"14px 18px" }}>
        <div style={{ fontSize:"11px", letterSpacing:"2px", color:blue, fontFamily:"monospace", textTransform:"uppercase", marginBottom:"10px" }}>Plan Tiers & Points</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
          {SERVICE_PLANS.map(p=>(
            <div key={p.id} style={{ background:"#fff", border:`1px solid ${PLAN_COLORS[p.id]}44`, borderLeft:`3px solid ${PLAN_COLORS[p.id]}`, borderRadius:"4px", padding:"3px 10px", fontSize:"12px", display:"flex", gap:"8px", alignItems:"center" }}>
              <span style={{ fontWeight:"700", color:dark }}>{p.label}</span>
              <span style={{ color:muted }}>{p.freq}</span>
              <span style={{ color:blue, fontFamily:"monospace", fontWeight:"700" }}>+{p.pts}pts</span>
              <span style={{ color:"#10b981", fontFamily:"monospace" }}>${p.ltv_yr.toLocaleString()}/yr LTV</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── REVIEW LEADERBOARD ───────────────────────────────────────────────────────
function ReviewLeaderboard({ techs, reviews, currentId }) {
  const mk = getMonthKey();
  const byMonth = {};
  reviews.forEach(r => {
    if (!byMonth[r.month_key]) byMonth[r.month_key]={};
    byMonth[r.month_key][r.tech_id] = (byMonth[r.month_key][r.tech_id]||0)+r.count;
  });
  const allMonths = Object.keys(byMonth).sort((a,b)=>b.localeCompare(a));
  const mData = byMonth[mk]||{};
  const allTimeCount={};
  reviews.forEach(r=>{ allTimeCount[r.tech_id]=(allTimeCount[r.tech_id]||0)+r.count; });
  const ranked = [...techs].map(t=>({...t, thisMonth:mData[t.id]||0, allTime:allTimeCount[t.id]||0})).sort((a,b)=>b.thisMonth-a.thisMonth);
  const top=ranked[0]?.thisMonth||1;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"20px" }}>
      <div style={{ background:"linear-gradient(135deg,#fff8e1,#fffbf0)", border:`1px solid #f5c54244`, borderRadius:"10px", padding:"16px 20px" }}>
        <div style={{ fontSize:"11px", letterSpacing:"3px", color:"#b7860b", fontFamily:"monospace", textTransform:"uppercase", marginBottom:"8px" }}>⭐ Point System</div>
        <div style={{ display:"flex", gap:"16px", flexWrap:"wrap" }}>
          <div style={{ fontSize:"13px", color:dark }}><strong style={{ color:"#b7860b" }}>+{REVIEW_PTS} pts</strong> per 5-star review</div>
          <div style={{ fontSize:"13px", color:dark }}><strong style={{ color:"#b7860b" }}>+{REVIEW_BONUS_PTS} bonus pts</strong> for 10+ reviews in a month</div>
        </div>
      </div>
      <div style={{ background:"linear-gradient(135deg,#e6f4ff,#f0f9ff)", border:`1px solid ${blue}44`, borderRadius:"10px", padding:"16px 20px" }}>
        <div style={{ fontSize:"11px", letterSpacing:"3px", color:blue, fontFamily:"monospace", textTransform:"uppercase", marginBottom:"12px" }}>⭐ All-Time Review Totals</div>
        {[...techs].sort((a,b)=>(allTimeCount[b.id]||0)-(allTimeCount[a.id]||0)).map((t,i)=>{
          const cnt=allTimeCount[t.id]||0; const topCnt=Math.max(...techs.map(x=>allTimeCount[x.id]||0))||1; const pct=Math.round((cnt/topCnt)*100);
          return (
            <div key={t.id} style={{ marginBottom:"8px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"3px" }}>
                <span style={{ fontSize:"13px", fontWeight:t.id===currentId?"800":"600", color:t.id===currentId?blue:dark }}>{medal(i)} {t.name}{t.id===currentId?" (you)":""}</span>
                <span style={{ fontFamily:"monospace", fontWeight:"700", fontSize:"13px", color:dark }}>{cnt} reviews</span>
              </div>
              <div style={{ background:bord, borderRadius:"3px", height:"4px", overflow:"hidden" }}>
                <div style={{ width:`${pct}%`, height:"100%", background:"linear-gradient(90deg,#f5c542,#f59e0b)", borderRadius:"3px" }} />
              </div>
            </div>
          );
        })}
      </div>
      <div>
        <div style={{ fontSize:"11px", letterSpacing:"3px", color:blue, fontFamily:"monospace", textTransform:"uppercase", marginBottom:"12px" }}>This Month · {formatMonthLabel(mk)}</div>
        <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
          {ranked.map((t,idx)=>{
            const isMe=t.id===currentId; const pct=top>0?Math.round((t.thisMonth/top)*100):0; const bonus=t.thisMonth>=10?REVIEW_BONUS_PTS:0;
            return (
              <div key={t.id} style={{ background:isMe?"#e6f4ff":card, border:`1px solid ${isMe?blue:bord}`, borderRadius:"10px", padding:"16px 18px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"14px", marginBottom:"10px" }}>
                  <div style={{ width:"30px", textAlign:"center", fontSize:idx<3?"20px":"13px", color:muted, fontFamily:"monospace", fontWeight:"700" }}>{medal(idx)}</div>
                  <div style={{ width:"40px", height:"40px", borderRadius:"50%", background:`${blue}22`, border:`1px solid ${blue}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"12px", fontWeight:"700", color:blue, fontFamily:"monospace", flexShrink:0 }}>{t.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:"700", fontSize:"15px", color:dark }}>{t.name}{isMe&&<span style={{ fontSize:"10px", color:blue, fontFamily:"monospace" }}> YOU</span>}</div>
                    <div style={{ fontSize:"12px", color:muted, fontFamily:"monospace" }}>All-time: {t.allTime} reviews</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:"22px", fontWeight:"900", color:t.thisMonth>0?dark:bord }}>{t.thisMonth}</div>
                    <div style={{ fontSize:"11px", color:"#f5c542", fontFamily:"monospace" }}>+{(t.thisMonth*REVIEW_PTS)+bonus} pts{bonus>0?" 🔥":""}</div>
                  </div>
                </div>
                <div style={{ background:bord, borderRadius:"4px", height:"5px", overflow:"hidden" }}>
                  <div style={{ width:`${pct}%`, height:"100%", background:"linear-gradient(90deg,#f5c542,#f59e0b)", borderRadius:"4px" }} />
                </div>
                {t.thisMonth>=10&&<div style={{ marginTop:"8px", fontSize:"11px", color:"#b7860b", fontFamily:"monospace", background:"#fff8e1", padding:"4px 10px", borderRadius:"4px", display:"inline-block" }}>🔥 10+ review bonus unlocked!</div>}
              </div>
            );
          })}
        </div>
      </div>
      {allMonths.length>0&&(
        <div>
          <div style={{ fontSize:"11px", letterSpacing:"3px", color:blue, fontFamily:"monospace", textTransform:"uppercase", marginBottom:"12px" }}>Monthly History</div>
          <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
            {allMonths.map(m=>{
              const d=byMonth[m]||{}; const rows=[...techs].map(t=>({...t,cnt:d[t.id]||0})).filter(t=>t.cnt>0).sort((a,b)=>b.cnt-a.cnt); const total=rows.reduce((s,t)=>s+t.cnt,0);
              return (
                <div key={m} style={{ background:card, border:`1px solid ${m===mk?blue:bord}`, borderRadius:"10px", overflow:"hidden" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 16px", borderBottom:`1px solid ${bord}`, background:m===mk?"#e6f4ff":"#eef6ff" }}>
                    <div style={{ fontWeight:"700", fontSize:"13px", color:dark }}>{formatMonthLabel(m)}{m===mk&&<span style={{ fontSize:"10px", color:blue, fontFamily:"monospace" }}> CURRENT</span>}</div>
                    <div style={{ fontFamily:"monospace", color:"#b7860b", fontWeight:"700", fontSize:"13px" }}>{total} reviews</div>
                  </div>
                  <div style={{ padding:"10px 16px", display:"flex", flexDirection:"column", gap:"5px" }}>
                    {rows.map((t,i)=>(<div key={t.id} style={{ display:"flex", justifyContent:"space-between" }}><div style={{ display:"flex", alignItems:"center", gap:"6px" }}><span>{medal(i)}</span><span style={{ fontSize:"13px", color:dark }}>{t.name}</span></div><span style={{ fontFamily:"monospace", fontWeight:"700", fontSize:"13px", color:dark }}>{t.cnt} ⭐</span></div>))}
                    {rows.length===0&&<div style={{ fontSize:"12px", color:muted }}>No reviews logged</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TOTAL LEADERBOARD ────────────────────────────────────────────────────────
function TotalLeaderboard({ techs, upsells, switchovers, reviews }) {
  const ranked = [...techs].map(t => {
    const totals = calcTechTotals(t, upsells, switchovers, reviews);
    const tier = getTier(totals.total);
    return {...t, ...totals, tier};
  }).sort((a,b)=>b.total-a.total);
  const top = ranked[0]?.total||1;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
      {ranked.map((t,idx)=>{
        const pct=Math.round((t.total/top)*100);
        return (
          <div key={t.id} style={{ background:card, border:`1px solid ${bord}`, borderRadius:"10px", padding:"16px 18px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"14px", marginBottom:"12px" }}>
              <div style={{ width:"30px", textAlign:"center", fontSize:idx<3?"20px":"13px", color:muted, fontFamily:"monospace", fontWeight:"700" }}>{medal(idx)}</div>
              <div style={{ width:"40px", height:"40px", borderRadius:"50%", background:`${blue}22`, border:`1px solid ${blue}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"12px", fontWeight:"700", color:blue, fontFamily:"monospace", flexShrink:0 }}>{t.avatar}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:"700", fontSize:"15px", color:dark }}>{t.name}</div>
                <div style={{ fontSize:"11px", color:t.tier.color, fontFamily:"monospace", fontWeight:"700" }}>{t.tier.icon} {t.tier.name}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:"24px", fontWeight:"900", color:dark }}>{t.total.toLocaleString()}</div>
                <div style={{ fontSize:"11px", color:muted, fontFamily:"monospace" }}>total pts</div>
              </div>
            </div>
            <div style={{ background:bord, borderRadius:"4px", height:"6px", overflow:"hidden", marginBottom:"10px" }}>
              <div style={{ width:`${pct}%`, height:"100%", background:`linear-gradient(90deg,${blue},#0066cc)`, borderRadius:"4px", transition:"width 1s ease" }} />
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"8px" }}>
              {[
                {label:"🏅 Badges", val:t.badgePts, color:"#7c3aed"},
                {label:"💰 Upsells", val:`$${Math.round(t.upsellAmt).toLocaleString()}`, color:"#10b981"},
                {label:"🔄 Converts", val:t.switchPts, color:blue},
                {label:"⭐ Reviews", val:t.reviewPts, color:"#f5c542"},
              ].map(item=>(
                <div key={item.label} style={{ background:"#fff", border:`1px solid ${bord}`, borderRadius:"6px", padding:"8px 10px", textAlign:"center" }}>
                  <div style={{ fontSize:"11px", color:muted, marginBottom:"2px" }}>{item.label}</div>
                  <div style={{ fontSize:"14px", fontWeight:"800", color:item.color }}>{typeof item.val==="number"?item.val.toLocaleString():item.val}</div>
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
function JourneyBoard({ techs, upsells, switchovers, reviews }) {
  const [selected, setSelected] = useState(null);
  const ranked = [...techs].map(t => {
    const totals = calcTechTotals(t, upsells, switchovers, reviews);
    const tier = getTier(totals.total);
    const nextTier = JOURNEY_TIERS.find(t2 => t2.minPts > totals.total);
    const ptsToNext = nextTier ? nextTier.minPts - totals.total : 0;
    const tierPct = nextTier ? Math.round(((totals.total - tier.minPts) / (nextTier.minPts - tier.minPts)) * 100) : 100;
    const totalReviews = reviews.filter(r=>r.tech_id===t.id).reduce((s,r)=>s+r.count,0);
    const totalSwitches = switchovers.filter(s=>s.tech_id===t.id).length;
    return {...t, ...totals, tier, nextTier, ptsToNext, tierPct, totalReviews, totalSwitches};
  }).sort((a,b)=>b.total-a.total);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"24px" }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:"16px" }}>
        {ranked.map((t,idx) => (
          <JourneyCard key={t.id} tech={t} rank={idx+1} total={ranked.length}
            onClick={() => setSelected(selected===t.id?null:t.id)} expanded={selected===t.id} />
        ))}
      </div>
      <div style={{ background:card, border:`1px solid ${bord}`, borderRadius:"12px", padding:"20px" }}>
        <div style={{ fontSize:"11px", letterSpacing:"3px", color:blue, fontFamily:"monospace", textTransform:"uppercase", marginBottom:"14px" }}>Arena Tiers</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:"10px" }}>
          {JOURNEY_TIERS.map(tier=>(
            <div key={tier.id} style={{ background:tier.bg, borderRadius:"8px", padding:"14px", border:`1px solid ${tier.glow}` }}>
              <div style={{ fontSize:"22px", marginBottom:"4px" }}>{tier.icon}</div>
              <div style={{ fontWeight:"800", fontSize:"16px", color:tier.color, fontFamily:"monospace", letterSpacing:"1px" }}>{tier.name}</div>
              <div style={{ fontSize:"11px", color:"rgba(255,255,255,0.5)", fontFamily:"monospace", marginBottom:"4px" }}>
                {tier.maxPts===Infinity?`${tier.minPts.toLocaleString()}+ pts`:`${tier.minPts.toLocaleString()} – ${tier.maxPts.toLocaleString()} pts`}
              </div>
              <div style={{ fontSize:"11px", color:"rgba(255,255,255,0.7)", marginBottom:"6px" }}>{tier.desc}</div>
              <div style={{ fontSize:"11px", color:tier.color, fontFamily:"monospace", fontWeight:"700" }}>🎁 {tier.reward}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function JourneyCard({ tech, rank, total, onClick, expanded }) {
  const tier = tech.tier;
  const earnedBadges = BADGE_DEFS.filter(b => tech.badges.includes(b.id));
  const tenure = formatTenure(tech.start_date);
  return (
    <div onClick={onClick} style={{ background:tier.bg, borderRadius:"14px", overflow:"hidden", border:`1px solid ${tier.glow}`, boxShadow:expanded?`0 0 32px ${tier.glow}`:`0 4px 16px rgba(0,0,0,0.3)`, cursor:"pointer", transition:"all 0.3s ease", transform:expanded?"scale(1.01)":"scale(1)" }}>
      <div style={{ height:"4px", background:`linear-gradient(90deg,${tier.color},${tier.glow})` }} />
      <div style={{ padding:"18px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"14px" }}>
          <div style={{ fontSize:"28px" }}>{tier.icon}</div>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:"800", fontSize:"17px", color:"#fff" }}>{tech.name}</div>
            <div style={{ fontSize:"11px", color:tier.color, fontFamily:"monospace", fontWeight:"700", letterSpacing:"1px", textTransform:"uppercase" }}>{tier.name} Arena</div>
            {tech.start_date && <div style={{ fontSize:"10px", color:"rgba(255,255,255,0.4)", fontFamily:"monospace", marginTop:"2px" }}>⏱ {tenure} with Skylo</div>}
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:"24px", fontWeight:"900", color:"#fff" }}>{tech.total.toLocaleString()}</div>
            <div style={{ fontSize:"10px", color:"rgba(255,255,255,0.5)", fontFamily:"monospace" }}>pts</div>
          </div>
        </div>
        {tech.nextTier?(
          <div style={{ marginBottom:"14px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"5px" }}>
              <div style={{ fontSize:"10px", color:"rgba(255,255,255,0.5)", fontFamily:"monospace" }}>Progress to {tech.nextTier.name}</div>
              <div style={{ fontSize:"10px", color:tier.color, fontFamily:"monospace" }}>{tech.ptsToNext.toLocaleString()} pts away</div>
            </div>
            <div style={{ background:"rgba(255,255,255,0.1)", borderRadius:"4px", height:"6px", overflow:"hidden" }}>
              <div style={{ width:`${tech.tierPct}%`, height:"100%", background:`linear-gradient(90deg,${tier.color},#fff)`, borderRadius:"4px", transition:"width 1s ease" }} />
            </div>
            <div style={{ fontSize:"10px", color:"rgba(255,255,255,0.35)", fontFamily:"monospace", marginTop:"3px" }}>{tech.tierPct}% complete · 🎁 {tech.nextTier.reward} unlocks at {tech.nextTier.minPts.toLocaleString()} pts</div>
          </div>
        ):(
          <div style={{ marginBottom:"14px", background:"rgba(255,255,255,0.08)", borderRadius:"6px", padding:"8px 12px", textAlign:"center" }}>
            <div style={{ fontSize:"12px", color:tier.color, fontWeight:"700", fontFamily:"monospace" }}>👑 LEGEND STATUS ACHIEVED</div>
          </div>
        )}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"6px", marginBottom:expanded?"14px":"0" }}>
          {[
            {label:"Badges", val:tech.badges.length, icon:"🏅"},
            {label:"Upsells", val:`$${Math.round(tech.upsellAmt).toLocaleString()}`, icon:"💰"},
            {label:"Converts", val:tech.totalSwitches, icon:"🔄"},
            {label:"Reviews", val:tech.totalReviews, icon:"⭐"},
          ].map(s=>(
            <div key={s.label} style={{ background:"rgba(255,255,255,0.07)", borderRadius:"6px", padding:"8px 4px", textAlign:"center" }}>
              <div style={{ fontSize:"14px" }}>{s.icon}</div>
              <div style={{ fontSize:"13px", fontWeight:"800", color:"#fff" }}>{s.val}</div>
              <div style={{ fontSize:"9px", color:"rgba(255,255,255,0.4)", fontFamily:"monospace" }}>{s.label}</div>
            </div>
          ))}
        </div>
        {expanded&&(
          <div style={{ borderTop:"1px solid rgba(255,255,255,0.1)", paddingTop:"14px", display:"flex", flexDirection:"column", gap:"12px" }}>
            <div>
              <div style={{ fontSize:"10px", color:"rgba(255,255,255,0.4)", fontFamily:"monospace", letterSpacing:"2px", textTransform:"uppercase", marginBottom:"8px" }}>Points Breakdown</div>
              {[
                {label:"🏅 Badge Points", val:tech.badgePts, color:"#a78bfa"},
                {label:"💰 Upsell Points", val:tech.upsellPts, color:"#34d399"},
                {label:"🔄 Switchover Points", val:tech.switchPts, color:blue},
                {label:"⭐ Review Points", val:tech.reviewPts, color:"#f5c542"},
              ].map(item=>(
                <div key={item.label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"5px" }}>
                  <div style={{ fontSize:"12px", color:"rgba(255,255,255,0.6)" }}>{item.label}</div>
                  <div style={{ fontSize:"13px", fontWeight:"700", color:item.color, fontFamily:"monospace" }}>{item.val.toLocaleString()}</div>
                </div>
              ))}
            </div>
            {tech.start_date&&(
              <div style={{ background:"rgba(255,255,255,0.06)", borderRadius:"6px", padding:"10px 12px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontSize:"12px", color:"rgba(255,255,255,0.5)" }}>Start Date</div>
                <div style={{ fontSize:"13px", fontWeight:"700", color:"rgba(255,255,255,0.8)", fontFamily:"monospace" }}>{new Date(tech.start_date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})} · {tenure}</div>
              </div>
            )}
            {earnedBadges.length>0&&(
              <div>
                <div style={{ fontSize:"10px", color:"rgba(255,255,255,0.4)", fontFamily:"monospace", letterSpacing:"2px", textTransform:"uppercase", marginBottom:"8px" }}>Badges Earned</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:"5px" }}>
                  {earnedBadges.map(b=>(
                    <div key={b.id} style={{ background:"rgba(255,255,255,0.1)", border:`1px solid ${tier.glow}`, borderRadius:"4px", padding:"3px 8px", fontSize:"11px", color:"#fff", fontFamily:"monospace" }}>{b.icon} {b.name}</div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div style={{ fontSize:"10px", color:"rgba(255,255,255,0.4)", fontFamily:"monospace", letterSpacing:"2px", textTransform:"uppercase", marginBottom:"8px" }}>Current Perks</div>
              {tier.perks.map((p,i)=>(
                <div key={i} style={{ fontSize:"12px", color:"rgba(255,255,255,0.7)", display:"flex", alignItems:"center", gap:"6px", marginBottom:"4px" }}>
                  <span style={{ color:tier.color }}>✓</span> {p}
                </div>
              ))}
            </div>
            <div style={{ background:"rgba(255,255,255,0.06)", borderRadius:"6px", padding:"10px 12px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontSize:"12px", color:"rgba(255,255,255,0.5)" }}>Team Rank</div>
              <div style={{ fontSize:"16px", fontWeight:"900", color:tier.color, fontFamily:"monospace" }}>#{rank} of {total}</div>
            </div>
          </div>
        )}
        <div style={{ textAlign:"center", marginTop:"10px", fontSize:"10px", color:"rgba(255,255,255,0.2)", fontFamily:"monospace" }}>{expanded?"TAP TO COLLAPSE":"TAP TO EXPAND"}</div>
      </div>
    </div>
  );
}

// ─── TECH DASHBOARD ───────────────────────────────────────────────────────────
function TechDashboard({ tech, techs, upsells, switchovers, reviews, onLogout }) {
  const [tab, setTab] = useState("overview");
  const totals = calcTechTotals(tech, upsells, switchovers, reviews);
  const tier = getTier(totals.total);
  const nextTier = JOURNEY_TIERS.find(t => t.minPts > totals.total);
  const allRanked = [...techs].map(t=>({...t,...calcTechTotals(t,upsells,switchovers,reviews)})).sort((a,b)=>b.total-a.total);
  const myPos = allRanked.findIndex(t=>t.id===tech.id)+1;
  const maxPts = allRanked[0]?.total||1;
  const pct = Math.round((totals.total/maxPts)*100);
  const wk = getWeekKey(); const mk = getMonthKey();
  const thisWeekUpsell = upsells.filter(u=>u.tech_id===tech.id&&u.week_key===wk).reduce((s,u)=>s+u.amount,0);
  const thisMonthReviews = reviews.filter(r=>r.tech_id===tech.id&&r.month_key===mk).reduce((s,r)=>s+r.count,0);
  const tenure = formatTenure(tech.start_date);
  return (
    <div style={{ minHeight:"100vh", background:bg, color:dark }}>
      <Header right={<LogoutBtn onLogout={onLogout}/>}/>
      <TabBar tabs={[["overview","Overview"],["badges","Badges"],["upsells","Upsells"],["switchovers","Switchovers"],["reviews","⭐ Reviews"],["total","🏆 Total"],["journey","🗺️ Journey"]]} active={tab} setActive={setTab}/>
      <div style={{ padding:"24px", maxWidth:"800px", margin:"0 auto" }}>
        {tab==="overview"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"12px" }}>
              <StatCard label="Total Points" value={totals.total.toLocaleString()} color={blue}/>
              <StatCard label="Team Rank" value={`#${myPos} of ${techs.length}`} color="#10b981"/>
              <StatCard label="This Week Upsells" value={`$${thisWeekUpsell.toLocaleString()}`} color="#f59e0b" sub={`All-time: $${Math.round(totals.upsellAmt).toLocaleString()}`}/>
              <StatCard label="Reviews This Month" value={thisMonthReviews} color="#f5c542" sub={`All-time: ${reviews.filter(r=>r.tech_id===tech.id).reduce((s,r)=>s+r.count,0)}`}/>
            </div>
            <div style={{ background:tier.bg, border:`1px solid ${tier.glow}`, borderRadius:"10px", padding:"20px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"12px" }}>
                <div>
                  <div style={{ fontSize:"10px", color:"rgba(255,255,255,0.5)", letterSpacing:"2px", textTransform:"uppercase", fontFamily:"monospace", marginBottom:"4px" }}>Current Arena</div>
                  <div style={{ fontSize:"26px", fontWeight:"900", color:tier.color }}>{tier.icon} {tier.name}</div>
                  {tech.start_date&&<div style={{ fontSize:"11px", color:"rgba(255,255,255,0.5)", fontFamily:"monospace", marginTop:"2px" }}>⏱ {tenure} with Skylo</div>}
                </div>
                <div style={{ fontSize:"12px", color:"rgba(255,255,255,0.5)", fontFamily:"monospace" }}>{pct}% of leader</div>
              </div>
              {nextTier&&(
                <>
                  <div style={{ background:"rgba(255,255,255,0.1)", borderRadius:"4px", height:"8px", overflow:"hidden", marginBottom:"6px" }}>
                    <div style={{ width:`${Math.round(((totals.total-tier.minPts)/(nextTier.minPts-tier.minPts))*100)}%`, height:"100%", background:`linear-gradient(90deg,${tier.color},#fff)`, borderRadius:"4px", transition:"width 1s ease" }}/>
                  </div>
                  <div style={{ fontSize:"11px", color:"rgba(255,255,255,0.4)", fontFamily:"monospace" }}>{(nextTier.minPts-totals.total).toLocaleString()} pts to {nextTier.name} · 🎁 {nextTier.reward}</div>
                </>
              )}
            </div>
            <div style={{ background:card, border:`1px solid ${bord}`, borderRadius:"8px", padding:"20px" }}>
              <div style={{ fontSize:"10px", color:muted, letterSpacing:"2px", textTransform:"uppercase", fontFamily:"monospace", marginBottom:"12px" }}>My Badges</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:"8px" }}>
                {BADGE_DEFS.filter(b=>tech.badges.includes(b.id)).map(b=>(
                  <div key={b.id} style={{ display:"flex", alignItems:"center", gap:"6px", background:"#e6f4ff", border:`1px solid ${blue}33`, borderRadius:"6px", padding:"6px 12px" }}>
                    <span style={{ fontSize:"16px" }}>{b.icon}</span>
                    <div><div style={{ fontSize:"12px", fontWeight:"700", color:dark }}>{b.name}</div><div style={{ fontSize:"11px", color:blue, fontFamily:"monospace" }}>+{b.pts} pts</div></div>
                  </div>
                ))}
                {tech.badges.length===0&&<div style={{ fontSize:"13px", color:muted }}>No badges yet</div>}
              </div>
            </div>
          </div>
        )}
        {tab==="badges"&&<BadgeGrid earned={tech.badges}/>}
        {tab==="upsells"&&<UpsellLeaderboard techs={techs} upsells={upsells} currentId={tech.id}/>}
        {tab==="switchovers"&&<SwitchoverLeaderboard techs={techs} switchovers={switchovers} currentId={tech.id}/>}
        {tab==="reviews"&&<ReviewLeaderboard techs={techs} reviews={reviews} currentId={tech.id}/>}
        {tab==="total"&&<TotalLeaderboard techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews}/>}
        {tab==="journey"&&(
          <div>
            <div style={{ fontSize:"13px", color:muted, marginBottom:"20px" }}>Every tech's personal journey. Tiers unlock at 1,600 · 3,200 · 6,000 · 12,000 pts. Tap any card to expand.</div>
            <JourneyBoard techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews}/>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────
function AdminPanel({ techs, setTechs, upsells, setUpsells, switchovers, setSwitchovers, reviews, setReviews, onLogout, refreshAll }) {
  const [tab, setTab] = useState("upsells");
  const [awardForm, setAwardForm] = useState({techId:"",badgeId:""});
  const [addForm, setAddForm] = useState({name:"",pin:"",avatar:"",start_date:""});
  const [upsellForm, setUpsellForm] = useState({});
  const [swForm, setSwForm] = useState({techId:"",planId:""});
  const [reviewForm, setReviewForm] = useState({});
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);

  const showToast = (msg, ok=true) => { setToast({msg,ok}); setTimeout(()=>setToast(null),3500); };

  async function awardBadge() {
    if (!awardForm.techId||!awardForm.badgeId) return showToast("Select a tech and badge",false);
    const tech=techs.find(t=>t.id===awardForm.techId);
    if (tech.badges.includes(awardForm.badgeId)) return showToast(`${tech.name} already has this badge`,false);
    setSaving(true);
    try {
      await sb(`techs?id=eq.${tech.id}`,{method:"PATCH",body:JSON.stringify({badges:[...tech.badges,awardForm.badgeId]}),prefer:"return=minimal"});
      await refreshAll(); showToast(`✅ Badge awarded to ${tech.name}!`); setAwardForm({techId:"",badgeId:""});
    } catch(e){showToast("Error: "+e.message,false);}
    setSaving(false);
  }
  async function revokeBadge(techId,badgeId) {
    const tech=techs.find(t=>t.id===techId); setSaving(true);
    try {
      await sb(`techs?id=eq.${techId}`,{method:"PATCH",body:JSON.stringify({badges:tech.badges.filter(b=>b!==badgeId)}),prefer:"return=minimal"});
      await refreshAll(); showToast("Badge removed");
    } catch(e){showToast("Error: "+e.message,false);}
    setSaving(false);
  }
  async function addTech() {
    if (!addForm.name||!addForm.pin||addForm.pin.length!==4) return showToast("Name + 4-digit PIN required",false);
    if (techs.find(t=>t.pin===addForm.pin)) return showToast("PIN already in use",false);
    setSaving(true);
    try {
      const avatar=addForm.avatar||addForm.name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
      await sb("techs",{method:"POST",body:JSON.stringify({name:addForm.name,pin:addForm.pin,avatar,badges:["day_one"],start_date:addForm.start_date||null})});
      await refreshAll(); showToast(`✅ ${addForm.name} added!`); setAddForm({name:"",pin:"",avatar:"",start_date:""});
    } catch(e){showToast("Error: "+e.message,false);}
    setSaving(false);
  }
  async function updateStartDate(techId, date) {
    try {
      await sb(`techs?id=eq.${techId}`,{method:"PATCH",body:JSON.stringify({start_date:date||null}),prefer:"return=minimal"});
      await refreshAll(); showToast("✅ Start date saved!");
    } catch(e){showToast("Error: "+e.message,false);}
  }
  async function saveUpsells() {
    const wk=getWeekKey(); setSaving(true);
    try {
      for (const t of techs) {
        const val=parseFloat(upsellForm[t.id]); if (isNaN(val)||val<=0) continue;
        const existing=await sb(`upsells?tech_id=eq.${t.id}&week_key=eq.${wk}&select=id`);
        if (existing&&existing.length>0) await sb(`upsells?id=eq.${existing[0].id}`,{method:"PATCH",body:JSON.stringify({amount:val}),prefer:"return=minimal"});
        else await sb("upsells",{method:"POST",body:JSON.stringify({tech_id:t.id,week_key:wk,amount:val})});
      }
      await refreshAll(); showToast("✅ Upsells saved!"); setUpsellForm({});
    } catch(e){showToast("Error: "+e.message,false);}
    setSaving(false);
  }
  async function logSwitchover() {
    if (!swForm.techId||!swForm.planId) return showToast("Select a tech and plan",false);
    setSaving(true);
    try {
      const wk=getWeekKey();
      await sb("switchovers",{method:"POST",body:JSON.stringify({tech_id:swForm.techId,week_key:wk,plan_id:swForm.planId})});
      await refreshAll(); const tech=techs.find(t=>t.id===swForm.techId); showToast(`✅ Switchover logged for ${tech.name}!`); setSwForm({techId:"",planId:""});
    } catch(e){showToast("Error: "+e.message,false);}
    setSaving(false);
  }
  async function saveReviews() {
    const mk=getMonthKey(); setSaving(true);
    try {
      for (const t of techs) {
        const val=parseInt(reviewForm[t.id]); if (isNaN(val)||val<=0) continue;
        const existing=await sb(`reviews?tech_id=eq.${t.id}&month_key=eq.${mk}&select=id`);
        if (existing&&existing.length>0) await sb(`reviews?id=eq.${existing[0].id}`,{method:"PATCH",body:JSON.stringify({count:val}),prefer:"return=minimal"});
        else await sb("reviews",{method:"POST",body:JSON.stringify({tech_id:t.id,month_key:mk,count:val})});
      }
      await refreshAll(); showToast("✅ Reviews saved!"); setReviewForm({});
    } catch(e){showToast("Error: "+e.message,false);}
    setSaving(false);
  }

  const wk=getWeekKey(); const mk=getMonthKey();
  const wkUpsells={}; upsells.filter(u=>u.week_key===wk).forEach(u=>{wkUpsells[u.tech_id]=u.amount;});
  const mkReviews={}; reviews.filter(r=>r.month_key===mk).forEach(r=>{mkReviews[r.tech_id]=r.count;});
  const allTimeUpsells={}; upsells.forEach(u=>{allTimeUpsells[u.tech_id]=(allTimeUpsells[u.tech_id]||0)+u.amount;});

  const selStyle=(val)=>({background:"#fff",border:`1px solid ${bord}`,color:val?dark:muted,padding:"10px 14px",borderRadius:"6px",fontSize:"14px",fontFamily:"monospace",width:"100%",boxSizing:"border-box"});
  const inpStyle={background:"#fff",border:`1px solid ${bord}`,color:dark,padding:"10px 14px",borderRadius:"6px",fontSize:"14px",fontFamily:"monospace",width:"100%",boxSizing:"border-box"};
  const btnStyle=(color)=>({background:saving?"#ccc":color||blue,border:"none",color:"#fff",padding:"12px",borderRadius:"6px",cursor:saving?"not-allowed":"pointer",fontSize:"14px",fontWeight:"700",letterSpacing:"1px",fontFamily:"monospace",width:"100%"});

  return (
    <div style={{ minHeight:"100vh", background:bg, color:dark }}>
      <Header title="Admin Panel" right={<LogoutBtn onLogout={onLogout}/>}/>
      <TabBar tabs={[["upsells","Upsells"],["reviews","⭐ Reviews"],["switchovers","Switchovers"],["award","Award Badge"],["add","Add Tech"],["manage","Manage"],["journey","🗺️ Journey"]]} active={tab} setActive={setTab} accentColor="#10b981"/>
      <div style={{ padding:"24px", maxWidth:"700px", margin:"0 auto" }}>

        {tab==="upsells"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
            <div style={{ background:card, border:`1px solid ${bord}`, borderRadius:"8px", padding:"24px", display:"flex", flexDirection:"column", gap:"14px" }}>
              <div style={{ fontSize:"11px", letterSpacing:"3px", color:"#10b981", fontFamily:"monospace" }}>ENTER THIS WEEK · {formatWeekLabel(wk)}</div>
              <div style={{ fontSize:"12px", color:muted }}>$2 = 1 point · each dollar logged earns half a point toward tiers</div>
              {techs.map(t=>(
                <div key={t.id} style={{ display:"flex", alignItems:"center", gap:"12px" }}>
                  <div style={{ width:"140px" }}>
                    <div style={{ fontSize:"14px", fontWeight:"600", color:dark }}>{t.name}</div>
                    <div style={{ fontSize:"11px", color:muted, fontFamily:"monospace" }}>current: ${(wkUpsells[t.id]||0).toLocaleString()}</div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:"6px", flex:1 }}>
                    <span style={{ color:muted, fontSize:"16px", fontWeight:"700" }}>$</span>
                    <input type="number" placeholder={wkUpsells[t.id]||"0"} value={upsellForm[t.id]||""} onChange={e=>setUpsellForm(f=>({...f,[t.id]:e.target.value}))}
                      style={{ background:"#fff", border:`1px solid ${bord}`, color:dark, padding:"8px 10px", borderRadius:"6px", fontSize:"14px", fontFamily:"monospace", width:"100%" }}/>
                  </div>
                </div>
              ))}
              <button onClick={saveUpsells} disabled={saving} style={btnStyle(blue)}>{saving?"SAVING...":"SAVE THIS WEEK"}</button>
            </div>
            <div style={{ background:card, border:`1px solid ${bord}`, borderRadius:"8px", padding:"20px" }}>
              <div style={{ fontSize:"11px", letterSpacing:"2px", color:blue, fontFamily:"monospace", textTransform:"uppercase", marginBottom:"12px" }}>All-Time Upsell Totals</div>
              {[...techs].sort((a,b)=>(allTimeUpsells[b.id]||0)-(allTimeUpsells[a.id]||0)).map((t,i)=>(
                <div key={t.id} style={{ display:"flex", justifyContent:"space-between", marginBottom:"8px" }}>
                  <span style={{ fontSize:"13px", color:dark }}>{medal(i)} {t.name}</span>
                  <span style={{ fontFamily:"monospace", fontWeight:"700", color:blue }}>${(allTimeUpsells[t.id]||0).toLocaleString()} · {Math.round((allTimeUpsells[t.id]||0)*UPSELL_PTS_PER_DOLLAR)} pts</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab==="reviews"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
            <div style={{ background:card, border:`1px solid ${bord}`, borderRadius:"8px", padding:"24px", display:"flex", flexDirection:"column", gap:"14px" }}>
              <div style={{ fontSize:"11px", letterSpacing:"3px", color:"#10b981", fontFamily:"monospace" }}>LOG 5-STAR REVIEWS · {formatMonthLabel(mk)}</div>
              <div style={{ fontSize:"12px", color:muted }}>+{REVIEW_PTS} pts per review · +{REVIEW_BONUS_PTS} bonus at 10+ reviews in a month</div>
              {techs.map(t=>(
                <div key={t.id} style={{ display:"flex", alignItems:"center", gap:"12px" }}>
                  <div style={{ width:"140px" }}>
                    <div style={{ fontSize:"14px", fontWeight:"600", color:dark }}>{t.name}</div>
                    <div style={{ fontSize:"11px", color:muted, fontFamily:"monospace" }}>this month: {mkReviews[t.id]||0} ⭐</div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:"6px", flex:1 }}>
                    <span style={{ color:"#f5c542", fontSize:"16px" }}>⭐</span>
                    <input type="number" placeholder={mkReviews[t.id]||"0"} value={reviewForm[t.id]||""} onChange={e=>setReviewForm(f=>({...f,[t.id]:e.target.value}))}
                      style={{ background:"#fff", border:`1px solid ${bord}`, color:dark, padding:"8px 10px", borderRadius:"6px", fontSize:"14px", fontFamily:"monospace", width:"100%" }}/>
                  </div>
                </div>
              ))}
              <button onClick={saveReviews} disabled={saving} style={btnStyle("#f5c542")}>{saving?"SAVING...":"SAVE THIS MONTH'S REVIEWS"}</button>
            </div>
          </div>
        )}

        {tab==="switchovers"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
            <div style={{ background:card, border:`1px solid ${bord}`, borderRadius:"8px", padding:"24px", display:"flex", flexDirection:"column", gap:"12px" }}>
              <div style={{ fontSize:"11px", letterSpacing:"3px", color:"#10b981", fontFamily:"monospace" }}>LOG A SWITCHOVER · {formatWeekLabel(wk)}</div>
              <select value={swForm.techId} onChange={e=>setSwForm(f=>({...f,techId:e.target.value}))} style={selStyle(swForm.techId)}>
                <option value="">— Select Tech —</option>
                {techs.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select value={swForm.planId} onChange={e=>setSwForm(f=>({...f,planId:e.target.value}))} style={selStyle(swForm.planId)}>
                <option value="">— Select Plan —</option>
                {SERVICE_PLANS.map(p=><option key={p.id} value={p.id}>{p.label} ({p.freq}) · +{p.pts}pts · ${p.ltv_yr.toLocaleString()}/yr LTV</option>)}
              </select>
              <button onClick={logSwitchover} disabled={saving} style={btnStyle(blue)}>{saving?"SAVING...":"LOG SWITCHOVER"}</button>
            </div>
          </div>
        )}

        {tab==="award"&&(
          <div style={{ background:card, border:`1px solid ${bord}`, borderRadius:"8px", padding:"24px", display:"flex", flexDirection:"column", gap:"12px" }}>
            <div style={{ fontSize:"11px", letterSpacing:"3px", color:"#10b981", fontFamily:"monospace" }}>AWARD A BADGE</div>
            <select value={awardForm.techId} onChange={e=>setAwardForm(f=>({...f,techId:e.target.value}))} style={selStyle(awardForm.techId)}>
              <option value="">— Select Tech —</option>
              {techs.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={awardForm.badgeId} onChange={e=>setAwardForm(f=>({...f,badgeId:e.target.value}))} style={selStyle(awardForm.badgeId)}>
              <option value="">— Select Badge —</option>
              {BADGE_DEFS.map(b=><option key={b.id} value={b.id}>{b.icon} {b.name} (+{b.pts} pts)</option>)}
            </select>
            <button onClick={awardBadge} disabled={saving} style={btnStyle(blue)}>{saving?"SAVING...":"AWARD BADGE"}</button>
          </div>
        )}

        {tab==="add"&&(
          <div style={{ background:card, border:`1px solid ${bord}`, borderRadius:"8px", padding:"24px", display:"flex", flexDirection:"column", gap:"12px" }}>
            <div style={{ fontSize:"11px", letterSpacing:"3px", color:"#10b981", fontFamily:"monospace" }}>ADD NEW TECH</div>
            <input placeholder="Full Name" value={addForm.name} onChange={e=>setAddForm(f=>({...f,name:e.target.value}))} style={inpStyle}/>
            <input placeholder="4-Digit PIN" value={addForm.pin} maxLength={4} onChange={e=>setAddForm(f=>({...f,pin:e.target.value.replace(/\D/g,"")}))} style={inpStyle}/>
            <input placeholder="Initials (optional)" value={addForm.avatar} maxLength={2} onChange={e=>setAddForm(f=>({...f,avatar:e.target.value.toUpperCase()}))} style={inpStyle}/>
            <div>
              <div style={{ fontSize:"12px", color:muted, marginBottom:"6px" }}>Start Date (for tenure tracking)</div>
              <input type="date" value={addForm.start_date} onChange={e=>setAddForm(f=>({...f,start_date:e.target.value}))} style={inpStyle}/>
            </div>
            <button onClick={addTech} disabled={saving} style={btnStyle("#10b981")}>{saving?"SAVING...":"ADD TECH"}</button>
          </div>
        )}

        {tab==="manage"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
            {techs.map(t=>(
              <div key={t.id} style={{ background:card, border:`1px solid ${bord}`, borderRadius:"8px", padding:"18px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"10px" }}>
                  <div style={{ fontWeight:"700", fontSize:"15px", color:dark }}>{t.name}</div>
                  <div style={{ fontSize:"12px", color:muted, fontFamily:"monospace" }}>PIN: {t.pin}</div>
                </div>
                <div style={{ marginBottom:"10px", display:"flex", alignItems:"center", gap:"10px" }}>
                  <div style={{ fontSize:"12px", color:muted }}>Start date:</div>
                  <input type="date" defaultValue={t.start_date||""} onBlur={e=>updateStartDate(t.id,e.target.value)}
                    style={{ background:"#fff", border:`1px solid ${bord}`, color:dark, padding:"4px 8px", borderRadius:"4px", fontSize:"12px", fontFamily:"monospace" }}/>
                  {t.start_date&&<span style={{ fontSize:"12px", color:blue, fontFamily:"monospace" }}>{formatTenure(t.start_date)}</span>}
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
                  {t.badges.map(bid=>{const b=BADGE_MAP[bid]; return b?(
                    <div key={bid} style={{ display:"flex", alignItems:"center", gap:"5px", background:"#e6f4ff", border:`1px solid ${blue}33`, borderRadius:"4px", padding:"3px 8px", fontSize:"12px" }}>
                      <span>{b.icon}</span><span style={{ color:dark }}>{b.name}</span>
                      <button onClick={()=>revokeBadge(t.id,bid)} style={{ background:"none", border:"none", color:"#ef4444", cursor:"pointer", fontSize:"13px", padding:"0 0 0 2px", lineHeight:1 }}>×</button>
                    </div>
                  ):null;})}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab==="journey"&&(
          <div>
            <div style={{ fontSize:"13px", color:muted, marginBottom:"20px" }}>All tech journeys — tap any card to see full breakdown.</div>
            <JourneyBoard techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews}/>
          </div>
        )}

      </div>
      {toast&&(
        <div style={{ position:"fixed", bottom:"24px", left:"50%", transform:"translateX(-50%)", background:toast.ok?"#10b981":"#ef4444", color:"#fff", padding:"12px 24px", borderRadius:"8px", fontSize:"14px", fontWeight:"600", zIndex:999, whiteSpace:"nowrap" }}>
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
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(null);

  const loadAll = useCallback(async () => {
    try {
      const [t,u,s,r] = await Promise.all([
        sb("techs?select=*&order=name"),
        sb("upsells?select=*"),
        sb("switchovers?select=*"),
        sb("reviews?select=*"),
      ]);
      setTechs(t||[]); setUpsells(u||[]); setSwitchovers(s||[]); setReviews(r||[]);
      return true;
    } catch(e) { setDbError(e.message); return false; }
  }, []);

  useEffect(() => {
    (async () => { const ok=await loadAll(); if(!ok){setLoading(false);return;} setLoading(false); })();
  }, []);

  function handlePin(pin) {
    if (pin===ADMIN_PIN) { setUser({type:"admin"}); return true; }
    const tech=techs?.find(t=>t.pin===pin);
    if (tech) { setUser({type:"tech",techId:tech.id}); return true; }
    return false;
  }

  const currentTech = user?.type==="tech" ? techs?.find(t=>t.id===user.techId) : null;

  if (loading) return (
    <div style={{ minHeight:"100vh", background:bg, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:"16px" }}>
      <Logo height={60}/><div style={{ color:blue, fontFamily:"monospace", letterSpacing:"3px", fontSize:"12px" }}>LOADING...</div>
    </div>
  );

  if (dbError) return (
    <div style={{ minHeight:"100vh", background:bg, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:"16px", padding:"24px", textAlign:"center" }}>
      <Logo height={60}/>
      <div style={{ color:"#ef4444", fontFamily:"monospace", fontSize:"13px", maxWidth:"600px" }}>
        <strong>Database setup needed.</strong> Run this SQL in Supabase → SQL Editor:<br/><br/>
        <code style={{ background:"#f4f8fd", padding:"12px", borderRadius:"6px", fontSize:"11px", display:"block", textAlign:"left", whiteSpace:"pre" }}>
{`alter table techs add column if not exists start_date date;

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  tech_id uuid references techs(id),
  month_key text,
  count integer default 0,
  created_at timestamptz default now()
);

alter table reviews enable row level security;
drop policy if exists "public access" on reviews;
create policy "public access" on reviews for all using (true) with check (true);`}
        </code><br/>
        <button onClick={()=>{setDbError(null);setLoading(true);loadAll().then(()=>setLoading(false));}} style={{ background:blue, border:"none", color:"#fff", padding:"10px 24px", borderRadius:"6px", cursor:"pointer", fontFamily:"monospace", fontSize:"13px" }}>RETRY</button>
      </div>
    </div>
  );

  if (!user) return (
    <div style={{ minHeight:"100vh", background:bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"40px" }}>
      <div style={{ textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center", gap:"16px" }}>
        <Logo height={80}/>
        <div>
          <div style={{ fontSize:"11px", letterSpacing:"4px", color:blue, textTransform:"uppercase", fontFamily:"monospace", marginBottom:"6px" }}>Field Operations</div>
          <h1 style={{ fontSize:"28px", fontWeight:"900", margin:0, letterSpacing:"-0.5px", color:dark }}>The Standard Board</h1>
          <p style={{ color:muted, marginTop:"6px", fontSize:"14px" }}>Enter your PIN to continue</p>
        </div>
      </div>
      <PinPad onSubmit={handlePin}/>
    </div>
  );

  if (user.type==="admin") return (
    <AdminPanel techs={techs} setTechs={setTechs} upsells={upsells} setUpsells={setUpsells}
      switchovers={switchovers} setSwitchovers={setSwitchovers} reviews={reviews} setReviews={setReviews}
      onLogout={()=>setUser(null)} refreshAll={loadAll}/>
  );
  if (user.type==="tech"&&currentTech) return (
    <TechDashboard tech={currentTech} techs={techs} upsells={upsells} switchovers={switchovers}
      reviews={reviews} onLogout={()=>setUser(null)}/>
  );
  return null;
}
