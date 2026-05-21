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
  blue:    "#009cff",
  blueDk:  "#0077cc",
  black:   "#080c10",
  dark:    "#0f1923",
  card:    "#141e2b",
  cardLt:  "#1a2535",
  border:  "#1e2d42",
  white:   "#ffffff",
  offWhite:"#e8eef5",
  muted:   "#5a7a9a",
  green:   "#00e676",
  gold:    "#ffd600",
  orange:  "#ff6b35",
  purple:  "#9c6dff",
};

const ADMIN_PIN = "0000";
const UPSELL_PTS_PER_DOLLAR = 0.5;
const REVIEW_PTS = 25;
const REVIEW_BONUS_PTS = 75;

const LOGO_SRC = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 50'%3E%3Crect width='200' height='50' fill='%23009cff' rx='4'/%3E%3Ctext x='100' y='34' font-family='monospace' font-size='22' font-weight='900' fill='white' text-anchor='middle'%3ESKYLO%3C/text%3E%3C/svg%3E";

// ─── BADGE DEFS ───────────────────────────────────────────────────────────────
const BADGE_DEFS = [
  { id:"day_one",         cat:"Tenure",      name:"Day One",           icon:"🔑", pts:50,   desc:"Completed first day on the job" },
  { id:"thirty_days",    cat:"Tenure",      name:"30-Day Survivor",   icon:"📅", pts:100,  desc:"First 30 days completed" },
  { id:"ninety_days",    cat:"Tenure",      name:"Quarter Strong",    icon:"📆", pts:200,  desc:"90 days on the team" },
  { id:"one_year",       cat:"Tenure",      name:"One Year Legend",   icon:"🏅", pts:500,  desc:"First full year" },
  { id:"two_year",       cat:"Tenure",      name:"Two Year Veteran",  icon:"🎖️", pts:750,  desc:"Two years of excellence" },
  { id:"five_year",      cat:"Tenure",      name:"Five Year Elite",   icon:"👑", pts:1500, desc:"Five years — rare and honored" },
  { id:"zero_callback",  cat:"Performance", name:"Zero Callbacks",    icon:"✅", pts:300,  desc:"Month with zero callbacks" },
  { id:"clean_streak",   cat:"Performance", name:"Clean Streak",      icon:"🔥", pts:600,  desc:"3 months straight, no callbacks" },
  { id:"five_star",      cat:"Performance", name:"5-Star Tech",       icon:"⭐", pts:150,  desc:"First 5-star review" },
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

const SERVICE_PLANS = [
  { id:"biannual",  label:"Bi-Annual",  freq:"2x/yr",   pts:25,  ltv:635  },
  { id:"quarterly", label:"Quarterly",  freq:"4x/yr",   pts:75,  ltv:1030 },
  { id:"bimonthly", label:"Bi-Monthly", freq:"6x/yr",   pts:120, ltv:1425 },
  { id:"monthly",   label:"Monthly",    freq:"12x/yr",  pts:200, ltv:2610 },
  { id:"biweekly",  label:"Bi-Weekly",  freq:"26x/yr",  pts:280, ltv:3900 },
  { id:"weekly",    label:"Weekly",     freq:"52x/yr",  pts:350, ltv:5850 },
];
const PLAN_MAP = Object.fromEntries(SERVICE_PLANS.map(p => [p.id, p]));
const PLAN_COLORS = { biannual:C.green, quarterly:C.blue, bimonthly:C.purple, monthly:C.blue, biweekly:C.gold, weekly:C.orange };

const JOURNEY_TIERS = [
  { id:"bronze",   name:"BRONZE",   icon:"🥉", minPts:0,     maxPts:1599,   color:"#cd7f32", bg:"#1a1000", reward:"Tier 1 — $150",    perks:["$150 reward","Badge tracking","Weekly upsells"] },
  { id:"silver",   name:"SILVER",   icon:"🥈", minPts:1600,  maxPts:3199,   color:"#a8c0d6", bg:"#0e1520", reward:"Tier 2 — $300",    perks:["$300 reward","Switchover bonuses","Monthly spotlight"] },
  { id:"gold",     name:"GOLD",     icon:"🥇", minPts:3200,  maxPts:5999,   color:"#ffd600", bg:"#1a1400", reward:"Tier 3 — $600",    perks:["$600 reward","Featured on board","Priority scheduling"] },
  { id:"platinum", name:"PLATINUM", icon:"💎", minPts:6000,  maxPts:11999,  color:"#c4b5fd", bg:"#0d0520", reward:"Tier 4 — $1,200",  perks:["$1,200 reward","Legend nomination","Annual award"] },
  { id:"legend",   name:"LEGEND",   icon:"👑", minPts:12000, maxPts:Infinity,color:"#ffd600", bg:"#1a1000", reward:"UNCAPPED",         perks:["All rewards","Hall of fame","Custom perk"] },
];
function getTier(pts) { return [...JOURNEY_TIERS].reverse().find(t => pts >= t.minPts) || JOURNEY_TIERS[0]; }

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const calcBadgePts = (badges) => (badges||[]).reduce((s,id) => s+(BADGE_MAP[id]?.pts||0), 0);
const medal = (i) => i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`;

function getWeekKey() {
  const now = new Date(), start = new Date(now);
  start.setDate(now.getDate()-now.getDay());
  return `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,"0")}-${String(start.getDate()).padStart(2,"0")}`;
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
function calcTotals(tech, upsells, switchovers, reviews) {
  const badgePts = calcBadgePts(tech.badges);
  const upsellAmt = upsells.filter(u=>u.tech_id===tech.id).reduce((s,u)=>s+u.amount,0);
  const upsellPts = Math.round(upsellAmt*UPSELL_PTS_PER_DOLLAR);
  const switchPts = switchovers.filter(s=>s.tech_id===tech.id).reduce((s,sw)=>s+(PLAN_MAP[sw.plan_id]?.pts||0),0);
  const byMonth = {};
  reviews.filter(r=>r.tech_id===tech.id).forEach(r=>{ byMonth[r.month_key]=(byMonth[r.month_key]||0)+r.count; });
  const reviewPts = Object.values(byMonth).reduce((s,cnt)=>s+(cnt*REVIEW_PTS)+(cnt>=10?REVIEW_BONUS_PTS:0),0);
  const total = badgePts+upsellPts+switchPts+reviewPts;
  return { badgePts, upsellAmt, upsellPts, switchPts, reviewPts, total };
}

// ─── GLOBAL STYLES ────────────────────────────────────────────────────────────
const GS = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=Barlow:wght@400;500;600;700&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:${C.dark}; color:${C.white}; font-family:'Barlow',sans-serif; -webkit-font-smoothing:antialiased; }
  ::-webkit-scrollbar { width:4px; } ::-webkit-scrollbar-track { background:${C.dark}; } ::-webkit-scrollbar-thumb { background:${C.border}; border-radius:2px; }
  input,select,button { font-family:'Barlow',sans-serif; }
  input[type=number]::-webkit-inner-spin-button { -webkit-appearance:none; }
`;

// ─── BASE COMPONENTS ──────────────────────────────────────────────────────────
function Logo({ h=40 }) {
  return <img src={LOGO_SRC} alt="Skylo" style={{ height:`${h}px`, objectFit:"contain" }}/>;
}

function Header({ right, title, subtitle }) {
  return (
    <div style={{ background:C.black, borderBottom:`2px solid ${C.blue}`, padding:"0 20px", display:"flex", alignItems:"center", justifyContent:"space-between", height:"60px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:"14px" }}>
        <Logo h={32}/>
        {title && (
          <div>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"16px", letterSpacing:"2px", textTransform:"uppercase", color:C.white, lineHeight:1 }}>{title}</div>
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
    <button onClick={onLogout} style={{ background:"none", border:`1px solid ${C.border}`, color:C.muted, padding:"6px 14px", borderRadius:"4px", cursor:"pointer", fontSize:"11px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", letterSpacing:"2px", textTransform:"uppercase" }}>
      EXIT
    </button>
  );
}

function TabBar({ tabs, active, setActive, accent }) {
  const ac = accent || C.blue;
  return (
    <div style={{ display:"flex", background:C.black, borderBottom:`1px solid ${C.border}`, overflowX:"auto", WebkitOverflowScrolling:"touch", scrollbarWidth:"none" }}>
      {tabs.map(([id,label]) => (
        <button key={id} onClick={()=>setActive(id)} style={{
          background:"none", border:"none", cursor:"pointer", whiteSpace:"nowrap",
          padding:"14px 18px", fontSize:"11px", letterSpacing:"2px", textTransform:"uppercase",
          fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700",
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
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${accent||color||C.blue}`, borderRadius:"6px", padding:"16px" }}>
      <div style={{ fontSize:"10px", color:C.muted, letterSpacing:"2px", textTransform:"uppercase", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", marginBottom:"8px" }}>{label}</div>
      <Num val={value} color={color||C.white} size={28}/>
      {sub && <div style={{ fontSize:"11px", color:C.muted, marginTop:"5px" }}>{sub}</div>}
    </div>
  );
}

function Bar({ pct, color=C.blue, h=5 }) {
  return (
    <div style={{ background:C.border, borderRadius:"2px", height:`${h}px`, overflow:"hidden" }}>
      <div style={{ width:`${Math.min(pct,100)}%`, height:"100%", background:color, borderRadius:"2px" }}/>
    </div>
  );
}

function Label({ children, color=C.blue }) {
  return (
    <div style={{ fontSize:"10px", color, letterSpacing:"2px", textTransform:"uppercase", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", marginBottom:"10px" }}>{children}</div>
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
          <div key={i} style={{ width:"14px", height:"14px", borderRadius:"50%", background:i<pin.length?C.blue:"transparent", border:`2px solid ${i<pin.length?C.blue:C.border}` }}/>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,72px)", gap:"10px" }}>
        {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((d,i)=>(
          <button key={i} onClick={()=>d==="⌫"?setPin(p=>p.slice(0,-1)):d!==""?press(String(d)):null}
            disabled={d===""}
            style={{ width:"72px", height:"72px", borderRadius:"6px", background:d===""?"transparent":C.card, border:d===""?"none":`1px solid ${C.border}`, color:d==="⌫"?C.muted:C.white, fontSize:d==="⌫"?"20px":"24px", fontWeight:"700", cursor:d===""?"default":"pointer", fontFamily:"'Barlow Condensed',sans-serif" }}>
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
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"24px" }}>
      {["Tenure","Performance","Skills","Character"].map(cat=>(
        <div key={cat}>
          <Label color={C.blue}>{cat}</Label>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:"8px" }}>
            {BADGE_DEFS.filter(b=>b.cat===cat).map(b=>{
              const has = earned.includes(b.id);
              return (
                <div key={b.id} style={{ background:has?`${C.blue}18`:C.card, border:`1px solid ${has?C.blue:C.border}`, borderRadius:"6px", padding:"14px", opacity:has?1:0.4 }}>
                  <div style={{ fontSize:"22px", marginBottom:"6px" }}>{b.icon}</div>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"14px", color:C.white, marginBottom:"2px" }}>{b.name}</div>
                  <div style={{ fontSize:"11px", color:C.muted, marginBottom:"6px", lineHeight:"1.3" }}>{b.desc}</div>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:"13px", fontWeight:"800", color:has?C.blue:C.muted }}>+{b.pts} PTS</div>
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
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"6px", padding:"14px 18px" }}>
        <Label color={C.green}>📅 Select Week</Label>
        <select
          value={selectedWeek}
          onChange={e=>setSelectedWeek(e.target.value)}
          style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.white, padding:"10px 14px", borderRadius:"6px", fontSize:"14px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", width:"100%", cursor:"pointer" }}
        >
          {allWeeks.length === 0 && <option value={wk}>{formatWeekLabel(wk)} — Current Week</option>}
          {allWeeks.map(w=>(
            <option key={w} value={w}>{formatWeekLabel(w)}{w===wk?" — Current":""}</option>
          ))}
        </select>
      </div>

      {/* Selected week breakdown */}
      <div style={{ background:C.card, border:`1px solid ${selectedWeek===wk?C.blue:C.border}`, borderTop:`3px solid ${C.green}`, borderRadius:"6px", overflow:"hidden" }}>
        <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}`, background:C.cardLt, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"16px", color:C.white }}>{formatWeekLabel(selectedWeek)}</div>
            {selectedWeek===wk&&<div style={{ fontSize:"10px", color:C.blue, letterSpacing:"1px", textTransform:"uppercase", marginTop:"2px" }}>Current Week</div>}
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"24px", color:C.green }}>${weekTotal.toLocaleString()}</div>
            <div style={{ fontSize:"10px", color:C.muted, letterSpacing:"1px" }}>TEAM TOTAL</div>
          </div>
        </div>
        <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"10px" }}>
          {ranked.map((t,idx)=>{
            const isMe=t.id===currentId; const pct=top>0?Math.round((t.amt/top)*100):0;
            return (
              <div key={t.id} style={{ background:isMe?`${C.blue}18`:"transparent", border:isMe?`1px solid ${C.blue}44`:"1px solid transparent", borderRadius:"6px", padding:"10px 12px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"8px" }}>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:idx<3?"20px":"13px", color:C.muted, width:"26px", textAlign:"center" }}>{medal(idx)}</div>
                  <div style={{ width:"36px", height:"36px", borderRadius:"50%", background:`${C.blue}22`, border:`1px solid ${C.blue}44`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Barlow Condensed',sans-serif", fontSize:"12px", fontWeight:"800", color:C.blue, flexShrink:0 }}>{t.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"15px", color:C.white }}>{t.name}{isMe&&<span style={{ color:C.blue, fontSize:"11px", marginLeft:"6px" }}>YOU</span>}</div>
                    <div style={{ fontSize:"11px", color:C.muted }}>+{Math.round(t.amt*UPSELL_PTS_PER_DOLLAR)} pts this week</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"22px", color:t.amt>0?C.white:C.border }}>${t.amt.toLocaleString()}</div>
                  </div>
                </div>
                <Bar pct={pct} color={C.green} h={4}/>
              </div>
            );
          })}
          {weekTotal===0&&<div style={{ fontSize:"13px", color:C.muted, textAlign:"center", padding:"12px" }}>No upsells logged for this week</div>}
        </div>
      </div>

      {/* Running totals pinned at bottom */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.green}`, borderRadius:"6px", overflow:"hidden" }}>
        <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}`, background:C.cardLt }}>
          <Label color={C.green}>💰 Running Totals — All Time</Label>
        </div>
        <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"10px" }}>
          {[...techs].sort((a,b)=>(allTime[b.id]||0)-(allTime[a.id]||0)).map((t,i)=>{
            const amt=allTime[t.id]||0; const topAmt=Math.max(...techs.map(x=>allTime[x.id]||0))||1; const pct=Math.round((amt/topAmt)*100);
            return (
              <div key={t.id}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"5px" }}>
                  <span style={{ fontSize:"13px", fontWeight:"600", color:t.id===currentId?C.blue:C.offWhite }}>{medal(i)} {t.name}{t.id===currentId?" — YOU":""}</span>
                  <div style={{ textAlign:"right" }}>
                    <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"14px", color:C.white }}>${amt.toLocaleString()}</span>
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
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"6px", overflow:"hidden" }}>
        <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}` }}><Label color={C.purple}>🔄 All-Time Switchovers</Label></div>
        <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"8px" }}>
          {[...techs].sort((a,b)=>(allPts[b.id]||0)-(allPts[a.id]||0)).map((t,i)=>(
            <div key={t.id} style={{ display:"flex", justifyContent:"space-between" }}>
              <span style={{ fontSize:"13px", color:t.id===currentId?C.blue:C.offWhite }}>{medal(i)} {t.name}{t.id===currentId?" — YOU":""}</span>
              <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"13px", color:C.white }}>{allCount[t.id]||0} converts · {(allPts[t.id]||0).toLocaleString()} pts</span>
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
              <div key={t.id} style={{ background:isMe?`${C.blue}18`:C.card, border:`1px solid ${isMe?C.blue:C.border}`, borderRadius:"6px", padding:"14px 18px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"10px" }}>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:idx<3?"22px":"14px", color:C.muted, width:"28px", textAlign:"center" }}>{medal(idx)}</div>
                  <div style={{ width:"38px", height:"38px", borderRadius:"50%", background:`${C.blue}22`, border:`1px solid ${C.blue}44`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Barlow Condensed',sans-serif", fontSize:"12px", fontWeight:"800", color:C.blue, flexShrink:0 }}>{t.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"16px", color:C.white }}>{t.name}{isMe&&<span style={{ color:C.blue, fontSize:"11px", marginLeft:"6px" }}>YOU</span>}</div>
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
                    {t.entries.map((e,i)=>{ const plan=PLAN_MAP[e.plan]; const pc=PLAN_COLORS[e.plan]||C.muted; return plan?(<span key={i} style={{ background:`${pc}22`, border:`1px solid ${pc}55`, borderLeft:`3px solid ${pc}`, borderRadius:"3px", padding:"2px 8px", fontSize:"11px", color:C.white, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>{plan.label} +{plan.pts}pts</span>):null; })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"6px", padding:"14px 18px" }}>
        <Label color={C.purple}>Plan Values</Label>
        <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
          {SERVICE_PLANS.map(p=>{ const pc=PLAN_COLORS[p.id]; return (
            <div key={p.id} style={{ background:`${pc}15`, border:`1px solid ${pc}44`, borderLeft:`3px solid ${pc}`, borderRadius:"4px", padding:"4px 10px", fontSize:"12px" }}>
              <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", color:C.white }}>{p.label} </span>
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
      <div style={{ background:`${C.gold}18`, border:`1px solid ${C.gold}44`, borderRadius:"6px", padding:"12px 18px", display:"flex", gap:"24px", flexWrap:"wrap" }}>
        <div><span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"20px", color:C.gold }}>+{REVIEW_PTS}</span><span style={{ fontSize:"12px", color:C.muted, marginLeft:"6px" }}>pts per review</span></div>
        <div><span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"20px", color:C.gold }}>+{REVIEW_BONUS_PTS}</span><span style={{ fontSize:"12px", color:C.muted, marginLeft:"6px" }}>bonus at 10+ in a month</span></div>
      </div>

      {/* Month selector */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"6px", padding:"14px 18px" }}>
        <Label color={C.gold}>📅 Select Month</Label>
        <select
          value={selectedMonth}
          onChange={e=>setSelectedMonth(e.target.value)}
          style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.white, padding:"10px 14px", borderRadius:"6px", fontSize:"14px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", width:"100%", cursor:"pointer" }}
        >
          {allMonths.length === 0 && <option value={mk}>{formatMonthLabel(mk)} — Current Month</option>}
          {allMonths.map(m=>(
            <option key={m} value={m}>{formatMonthLabel(m)}{m===mk?" — Current":""}</option>
          ))}
        </select>
      </div>

      {/* Selected month breakdown */}
      <div style={{ background:C.card, border:`1px solid ${selectedMonth===mk?C.gold:C.border}`, borderTop:`3px solid ${C.gold}`, borderRadius:"6px", overflow:"hidden" }}>
        <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}`, background:C.cardLt, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"16px", color:C.white }}>{formatMonthLabel(selectedMonth)}</div>
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
              <div key={t.id} style={{ background:isMe?`${C.blue}18`:"transparent", border:isMe?`1px solid ${C.blue}44`:"1px solid transparent", borderRadius:"6px", padding:"10px 12px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"8px" }}>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:idx<3?"20px":"13px", color:C.muted, width:"26px", textAlign:"center" }}>{medal(idx)}</div>
                  <div style={{ width:"36px", height:"36px", borderRadius:"50%", background:`${C.blue}22`, border:`1px solid ${C.blue}44`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Barlow Condensed',sans-serif", fontSize:"12px", fontWeight:"800", color:C.blue, flexShrink:0 }}>{t.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"15px", color:C.white }}>{t.name}{isMe&&<span style={{ color:C.blue, fontSize:"11px", marginLeft:"6px" }}>YOU</span>}</div>
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
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.gold}`, borderRadius:"6px", overflow:"hidden" }}>
        <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}`, background:C.cardLt }}>
          <Label color={C.gold}>⭐ Running Totals — All Time</Label>
        </div>
        <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"10px" }}>
          {[...techs].sort((a,b)=>(allTime[b.id]||0)-(allTime[a.id]||0)).map((t,i)=>{
            const cnt=allTime[t.id]||0; const topCnt=Math.max(...techs.map(x=>allTime[x.id]||0))||1; const pct=Math.round((cnt/topCnt)*100);
            return (
              <div key={t.id}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"5px" }}>
                  <span style={{ fontSize:"13px", color:t.id===currentId?C.blue:C.offWhite }}>{medal(i)} {t.name}{t.id===currentId?" — YOU":""}</span>
                  <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"14px", color:C.white }}>{cnt} ⭐</span>
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
function TotalLeaderboard({ techs, upsells, switchovers, reviews }) {
  const ranked = [...techs].map(t=>{ const tt=calcTotals(t,upsells,switchovers,reviews); return {...t,...tt,tier:getTier(tt.total)}; }).sort((a,b)=>b.total-a.total);
  const top = ranked[0]?.total||1;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
      {ranked.map((t,idx)=>{
        const pct=Math.round((t.total/top)*100);
        return (
          <div key={t.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"6px", padding:"16px 18px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"12px" }}>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:idx<3?"26px":"16px", color:C.muted, width:"32px", textAlign:"center" }}>{medal(idx)}</div>
              <div style={{ width:"42px", height:"42px", borderRadius:"50%", background:`${C.blue}22`, border:`1px solid ${C.blue}44`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Barlow Condensed',sans-serif", fontSize:"13px", fontWeight:"800", color:C.blue, flexShrink:0 }}>{t.avatar}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"18px", color:C.white }}>{t.name}</div>
                <Pill color={t.tier.color}>{t.tier.icon} {t.tier.name}</Pill>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"28px", color:C.white }}>{t.total.toLocaleString()}</div>
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
function JourneyBoard({ techs, upsells, switchovers, reviews }) {
  const [selected, setSelected] = useState(null);
  const ranked = [...techs].map(t=>{
    const tt=calcTotals(t,upsells,switchovers,reviews);
    const tier=getTier(tt.total);
    const nextTier=JOURNEY_TIERS.find(t2=>t2.minPts>tt.total);
    const ptsToNext=nextTier?nextTier.minPts-tt.total:0;
    const tierPct=nextTier?Math.round(((tt.total-tier.minPts)/(nextTier.minPts-tier.minPts))*100):100;
    const totalReviews=reviews.filter(r=>r.tech_id===t.id).reduce((s,r)=>s+r.count,0);
    const totalSwitches=switchovers.filter(s=>s.tech_id===t.id).length;
    return {...t,...tt,tier,nextTier,ptsToNext,tierPct,totalReviews,totalSwitches};
  }).sort((a,b)=>b.total-a.total);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"20px" }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:"12px" }}>
        {ranked.map((t,idx)=>(
          <JourneyCard key={t.id} tech={t} rank={idx+1} total={ranked.length}
            onClick={()=>setSelected(selected===t.id?null:t.id)} expanded={selected===t.id}/>
        ))}
      </div>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"6px", padding:"16px 18px" }}>
        <Label>Arena Tiers</Label>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:"8px" }}>
          {JOURNEY_TIERS.map(tier=>(
            <div key={tier.id} style={{ background:tier.bg, border:`1px solid ${tier.color}33`, borderLeft:`3px solid ${tier.color}`, borderRadius:"6px", padding:"12px" }}>
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

function JourneyCard({ tech, rank, total, onClick, expanded }) {
  const tier = tech.tier;
  const tenure = formatTenure(tech.start_date);
  const earnedBadges = BADGE_DEFS.filter(b=>tech.badges.includes(b.id));
  return (
    <div onClick={onClick} style={{ background:tier.bg, border:`1px solid ${tier.color}44`, borderTop:`3px solid ${tier.color}`, borderRadius:"6px", cursor:"pointer", overflow:"hidden" }}>
      <div style={{ padding:"16px 18px" }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:"14px" }}>
          <div>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"22px", color:C.white, lineHeight:1 }}>{tech.name}</div>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"13px", color:tier.color, letterSpacing:"2px", marginTop:"3px" }}>{tier.icon} {tier.name} ARENA</div>
            {tenure&&<div style={{ fontSize:"10px", color:C.muted, marginTop:"3px" }}>⏱ {tenure} with Skylo</div>}
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"30px", color:C.white, lineHeight:1 }}>{tech.total.toLocaleString()}</div>
            <div style={{ fontSize:"10px", color:C.muted, letterSpacing:"1px" }}>PTS</div>
            <div style={{ fontSize:"10px", color:tier.color, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", marginTop:"2px" }}>#{rank} of {total}</div>
          </div>
        </div>
        {tech.nextTier?(
          <div style={{ marginBottom:"14px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"5px" }}>
              <span style={{ fontSize:"10px", color:C.muted, letterSpacing:"1px", textTransform:"uppercase" }}>Next: {tech.nextTier.name}</span>
              <span style={{ fontSize:"10px", color:tier.color, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>{tech.ptsToNext.toLocaleString()} pts away</span>
            </div>
            <Bar pct={tech.tierPct} color={tier.color} h={6}/>
            <div style={{ fontSize:"10px", color:C.muted, marginTop:"4px" }}>{tech.tierPct}% · 🎁 {tech.nextTier.reward}</div>
          </div>
        ):(
          <div style={{ marginBottom:"14px", background:`${tier.color}18`, border:`1px solid ${tier.color}44`, borderRadius:"4px", padding:"8px 12px", textAlign:"center" }}>
            <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"13px", color:tier.color, letterSpacing:"2px" }}>👑 LEGEND STATUS ACHIEVED</span>
          </div>
        )}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"6px" }}>
          {[
            {l:"Badges",   v:tech.badges.length,        c:C.purple},
            {l:"Upsells",  v:`$${Math.round(tech.upsellAmt).toLocaleString()}`, c:C.green},
            {l:"Converts", v:tech.totalSwitches,        c:C.blue},
            {l:"Reviews",  v:tech.totalReviews,         c:C.gold},
          ].map(s=>(
            <div key={s.l} style={{ background:"rgba(0,0,0,0.3)", borderRadius:"4px", padding:"8px 4px", textAlign:"center" }}>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"16px", color:s.c }}>{s.v}</div>
              <div style={{ fontSize:"9px", color:C.muted, letterSpacing:"1px", textTransform:"uppercase" }}>{s.l}</div>
            </div>
          ))}
        </div>
        {expanded&&(
          <div style={{ borderTop:`1px solid ${tier.color}33`, paddingTop:"14px", marginTop:"14px", display:"flex", flexDirection:"column", gap:"12px" }}>
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
              <div style={{ background:"rgba(0,0,0,0.3)", borderRadius:"4px", padding:"10px 12px", display:"flex", justifyContent:"space-between" }}>
                <span style={{ fontSize:"12px", color:C.muted }}>Started</span>
                <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"13px", color:C.white }}>{new Date(tech.start_date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})} · {tenure}</span>
              </div>
            )}
            {earnedBadges.length>0&&(
              <div>
                <Label color={tier.color}>Badges</Label>
                <div style={{ display:"flex", flexWrap:"wrap", gap:"5px" }}>
                  {earnedBadges.map(b=>(
                    <span key={b.id} style={{ background:`${tier.color}18`, border:`1px solid ${tier.color}44`, borderRadius:"3px", padding:"2px 8px", fontSize:"11px", color:C.white, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>{b.icon} {b.name}</span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <Label color={tier.color}>Current Perks</Label>
              {tier.perks.map((p,i)=>(
                <div key={i} style={{ fontSize:"12px", color:C.offWhite, display:"flex", alignItems:"center", gap:"6px", marginBottom:"4px" }}>
                  <span style={{ color:tier.color, fontWeight:"800" }}>✓</span>{p}
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


// ─── INCENTIVE BOARD ─────────────────────────────────────────────────────────
const INCENTIVE_TIERS = [
  {
    pts: 1600,
    prize: "$150",
    color: "#cd7f32",
    icon: "🔥",
    name: "IGNITION",
    tagline: "You started. Now prove it.",
    items: [
      { name:"PS5 DualSense Controller", desc:"Brand new PS5 wireless controller", img:"https://images.unsplash.com/photo-1608096299210-db7e38487075?w=400&h=240&fit=crop&auto=format" },
      { name:"Steakhouse Dinner",        desc:"$150 gift card to your local steakhouse", img:"https://images.unsplash.com/photo-1544025162-d76694265947?w=400&h=240&fit=crop&auto=format" },
      { name:"Nike Air Max",             desc:"$150 Nike gift card — your pick", img:"https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&h=240&fit=crop&auto=format" },
      { name:"Concert Tickets",          desc:"2 tickets to a local show of your choice", img:"https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=400&h=240&fit=crop&auto=format" },
      { name:"Food Delivery Credit",     desc:"$150 DoorDash or Uber Eats credit", img:"https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=400&h=240&fit=crop&auto=format" },
    ],
  },
  {
    pts: 3200,
    prize: "$300",
    color: "#a8c0d6",
    icon: "⚡",
    name: "VOLTAGE",
    tagline: "The team is noticing.",
    items: [
      { name:"Xbox Series X",           desc:"Brand new console + 3 games", img:"https://images.unsplash.com/photo-1605979257913-1704eb7b6246?w=400&h=240&fit=crop&auto=format" },
      { name:"AutoZone / Summit Racing",desc:"$300 car parts gift card", img:"https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400&h=240&fit=crop&auto=format" },
      { name:"Hotel Weekend",           desc:"2-night hotel stay anywhere in-state", img:"https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=400&h=240&fit=crop&auto=format" },
      { name:"Range Day + Ammo",        desc:"$300 to your local gun range + ammo", img:"https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&h=240&fit=crop&auto=format" },
      { name:"Sony WH-1000XM5",        desc:"Top-tier noise cancelling headphones", img:"https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=240&fit=crop&auto=format" },
    ],
  },
  {
    pts: 6000,
    prize: "$600",
    color: "#ffd600",
    icon: "🏆",
    name: "OVERDRIVE",
    tagline: "Elite territory.",
    items: [
      { name:"PlayStation 5",           desc:"Brand new PS5 console", img:"https://images.unsplash.com/photo-1607853202273-797f1c22a38e?w=400&h=240&fit=crop&auto=format" },
      { name:"Supercar Track Day",      desc:"Drive a supercar at a real racing circuit", img:"https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=400&h=240&fit=crop&auto=format" },
      { name:"Flight + Hotel Weekend",  desc:"Flights + 2 nights in a city of your choice", img:"https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=400&h=240&fit=crop&auto=format" },
      { name:"Custom Wheels",           desc:"$600 toward rims, tires, or suspension", img:"https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=240&fit=crop&auto=format" },
      { name:"Nixon 500 Watch",         desc:"Gold Nixon 500 — clean, bold, built for you", img:"https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=240&fit=crop&auto=format" },
    ],
  },
  {
    pts: 12000,
    prize: "$1,200",
    color: "#c4b5fd",
    icon: "👑",
    name: "LEGEND",
    tagline: "One of one.",
    items: [
      { name:"3-Day Cruise",            desc:"Carnival or Royal Caribbean, you + a guest", img:"https://images.unsplash.com/photo-1548574505-5e239809ee19?w=400&h=240&fit=crop&auto=format" },
      { name:"All-Inclusive Resort",    desc:"3 nights Cancun or Dominican Republic", img:"https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=400&h=240&fit=crop&auto=format" },
      { name:"Performance Build Fund",  desc:"$1,200 toward your car build, no questions asked", img:"https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=400&h=240&fit=crop&auto=format" },
      { name:"VIP Concert Package",    desc:"Floor seats + backstage passes + hotel night", img:"https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&h=240&fit=crop&auto=format" },
      { name:"Vegas Trip",             desc:"Flights + 3 nights on the Strip + spending cash", img:"https://images.unsplash.com/photo-1605833556294-ea5c2a5339fd?w=400&h=240&fit=crop&auto=format" },
    ],
  },
];

function IncentiveBoard({ techs, upsells, switchovers, reviews, currentId }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.blue}`, borderRadius:"6px", padding:"16px 18px" }}>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"28px", color:C.white, letterSpacing:"3px", marginBottom:"4px" }}>SKYLO REWARDS PROGRAM</div>
        <div style={{ fontSize:"13px", color:C.muted }}>Stack your points from upsells, switchovers, reviews, and badges. Hit a tier, claim your prize.</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"8px", marginTop:"14px" }}>
          {[
            {l:"Upsells",    v:"$2 = 1 pt",       c:C.green},
            {l:"Reviews",    v:"25 pts each",      c:C.gold},
            {l:"Switchovers",v:"25–350 pts",       c:C.purple},
            {l:"Badges",     v:"50–1,500 pts",     c:C.blue},
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
          return calcTotals(tech, upsells, switchovers, reviews).total;
        })() : null;
        const unlocked = myTotal !== null && myTotal >= tier.pts;
        const progress = myTotal !== null ? Math.min(Math.round((myTotal / tier.pts) * 100), 100) : null;
        const prevPts = ti === 0 ? 0 : INCENTIVE_TIERS[ti-1].pts;
        const tierProgress = myTotal !== null ? Math.min(Math.round(((myTotal - prevPts) / (tier.pts - prevPts)) * 100), 100) : null;

        return (
          <div key={tier.name} style={{ background:C.card, border:`1px solid ${unlocked ? tier.color+"66" : C.border}`, borderTop:`4px solid ${tier.color}`, borderRadius:"6px", overflow:"hidden", opacity: unlocked || myTotal === null ? 1 : 0.85 }}>
            <div style={{ padding:"16px 18px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"28px", color:tier.color, letterSpacing:"3px", lineHeight:1 }}>{tier.icon} {tier.name}</div>
                <div style={{ fontSize:"12px", color:C.muted, marginTop:"3px" }}>{tier.tagline}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"38px", color:C.white, lineHeight:1 }}>{tier.prize}</div>
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
                  <div key={item.name} style={{ background:C.cardLt, borderRadius:"6px", overflow:"hidden", border:`1px solid ${C.border}` }}>
                    <img src={item.img} alt={item.name} style={{ width:"100%", height:"110px", objectFit:"cover", display:"block" }} loading="lazy"/>
                    <div style={{ padding:"10px" }}>
                      <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"13px", color:C.white, lineHeight:"1.2", marginBottom:"3px" }}>{item.name}</div>
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
function TechDashboard({ tech, techs, upsells, switchovers, reviews, onLogout }) {
  const [tab, setTab] = useState("overview");
  const tt = calcTotals(tech, upsells, switchovers, reviews);
  const tier = getTier(tt.total);
  const nextTier = JOURNEY_TIERS.find(t=>t.minPts>tt.total);
  const allRanked = [...techs].map(t=>({...t,...calcTotals(t,upsells,switchovers,reviews)})).sort((a,b)=>b.total-a.total);
  const myPos = allRanked.findIndex(t=>t.id===tech.id)+1;
  const wk=getWeekKey(), mk=getMonthKey();
  const weekUpsell = upsells.filter(u=>u.tech_id===tech.id&&u.week_key===wk).reduce((s,u)=>s+u.amount,0);
  const monthReviews = reviews.filter(r=>r.tech_id===tech.id&&r.month_key===mk).reduce((s,r)=>s+r.count,0);
  const tenure = formatTenure(tech.start_date);
  return (
    <div style={{ minHeight:"100vh", background:C.dark }}>
      <style>{GS}</style>
      <Header right={<LogoutBtn onLogout={onLogout}/>}/>
      <div style={{ background:C.black, borderBottom:`1px solid ${C.border}`, padding:"16px 20px 0" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"14px", marginBottom:"16px" }}>
          <div style={{ width:"52px", height:"52px", borderRadius:"50%", background:`${C.blue}22`, border:`2px solid ${C.blue}`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Barlow Condensed',sans-serif", fontSize:"16px", fontWeight:"900", color:C.blue, flexShrink:0 }}>{tech.avatar}</div>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"26px", color:C.white, lineHeight:1 }}>{tech.name}</div>
            <div style={{ display:"flex", gap:"8px", alignItems:"center", marginTop:"4px", flexWrap:"wrap" }}>
              <Pill color={tier.color}>{tier.icon} {tier.name}</Pill>
              {tenure&&<span style={{ fontSize:"11px", color:C.muted }}>⏱ {tenure}</span>}
            </div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"36px", color:C.white, lineHeight:1 }}>{tt.total.toLocaleString()}</div>
            <div style={{ fontSize:"10px", color:C.muted, letterSpacing:"2px" }}>TOTAL PTS</div>
          </div>
        </div>
        {nextTier&&(
          <div style={{ marginBottom:"14px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"5px" }}>
              <span style={{ fontSize:"10px", color:C.muted, letterSpacing:"1px" }}>NEXT: {nextTier.name} · {nextTier.reward}</span>
              <span style={{ fontSize:"10px", color:tier.color, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>{(nextTier.minPts-tt.total).toLocaleString()} PTS AWAY</span>
            </div>
            <Bar pct={Math.round(((tt.total-tier.minPts)/(nextTier.minPts-tier.minPts))*100)} color={tier.color} h={4}/>
          </div>
        )}
      </div>
      <TabBar tabs={[["overview","Overview"],["badges","Badges"],["upsells","Upsells"],["switchovers","Converts"],["reviews","⭐ Reviews"],["total","🏆 Total"],["journey","🗺️ Journey"],["incentive","🎁 Rewards"]]} active={tab} setActive={setTab}/>
      <div style={{ padding:"20px", maxWidth:"800px", margin:"0 auto" }}>
        {tab==="overview"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"10px" }}>
              <StatBlock label="Total Points" value={tt.total.toLocaleString()} color={C.blue} accent={C.blue}/>
              <StatBlock label="Team Rank" value={`#${myPos} / ${techs.length}`} color={C.green} accent={C.green}/>
              <StatBlock label="Week Upsells" value={`$${weekUpsell.toLocaleString()}`} color={C.white} sub={`All-time $${Math.round(tt.upsellAmt).toLocaleString()}`} accent={C.green}/>
              <StatBlock label="Month Reviews" value={monthReviews} color={C.gold} sub={`All-time ${reviews.filter(r=>r.tech_id===tech.id).reduce((s,r)=>s+r.count,0)}`} accent={C.gold}/>
            </div>
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${tier.color}`, borderRadius:"6px", padding:"16px 18px" }}>
              <Label color={tier.color}>Points Breakdown</Label>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"8px" }}>
                {[
                  {l:"🏅 Badges",    v:tt.badgePts,   c:C.purple},
                  {l:"💰 Upsells",   v:tt.upsellPts,  c:C.green},
                  {l:"🔄 Converts",  v:tt.switchPts,  c:C.blue},
                  {l:"⭐ Reviews",   v:tt.reviewPts,  c:C.gold},
                ].map(item=>(
                  <div key={item.l} style={{ background:C.cardLt, borderRadius:"4px", padding:"10px 12px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:"12px", color:C.muted }}>{item.l}</span>
                    <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"18px", color:item.c }}>{item.v.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
            {tech.badges.length>0&&(
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"6px", padding:"16px 18px" }}>
                <Label>My Badges</Label>
                <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
                  {BADGE_DEFS.filter(b=>tech.badges.includes(b.id)).map(b=>(
                    <div key={b.id} style={{ background:`${C.blue}18`, border:`1px solid ${C.blue}44`, borderRadius:"4px", padding:"6px 10px", display:"flex", alignItems:"center", gap:"6px" }}>
                      <span style={{ fontSize:"16px" }}>{b.icon}</span>
                      <div>
                        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"12px", color:C.white }}>{b.name}</div>
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
        {tab==="total"&&<TotalLeaderboard techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews}/>}
        {tab==="journey"&&(
          <div>
            <div style={{ fontSize:"13px", color:C.muted, marginBottom:"16px" }}>Tap any card to expand. Tiers unlock at 1,600 · 3,200 · 6,000 · 12,000 pts.</div>
            <JourneyBoard techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews}/>
          </div>
        )}
        {tab==="incentive"&&(
          <div>
            <div style={{ fontSize:"13px", color:C.muted, marginBottom:"16px" }}>Your personal progress toward each reward tier.</div>
            <IncentiveBoard techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews} currentId={tech.id}/>
          </div>
        )}
      </div>
    </div>
  );
}




// ─── DELETE TAB ───────────────────────────────────────────────────────────────
function DeleteTab({ techs, upsells, switchovers, reviews, saving, setSaving, refreshAll, showToast }) {
  const [section, setSection] = useState("upsells");
  const [filterTech, setFilterTech] = useState("");

  const selStyle = { background:C.cardLt, border:`1px solid ${C.border}`, color:C.white, padding:"8px 12px", borderRadius:"6px", fontSize:"13px", fontFamily:"'Barlow',sans-serif", width:"100%", cursor:"pointer" };

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
      <div style={{ background:`#ff444418`, border:`1px solid #ff444444`, borderRadius:"6px", padding:"12px 16px", fontSize:"12px", color:C.muted }}>
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
              <div key={u.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"6px", padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px" }}>
                <div>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"15px", color:C.white }}>{tech?.name}</div>
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
              <div key={s.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"6px", padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px" }}>
                <div>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"15px", color:C.white }}>{tech?.name}</div>
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
              <div key={r.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"6px", padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px" }}>
                <div>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"15px", color:C.white }}>{tech?.name}</div>
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
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.green}`, borderRadius:"6px", padding:"20px", display:"flex", flexDirection:"column", gap:"14px" }}>
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
              <input type="date" value={customDate} onChange={e=>setCustomDate(e.target.value)} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.white, padding:"8px 12px", borderRadius:"6px", fontSize:"14px", fontFamily:"'Barlow',sans-serif", width:"100%", boxSizing:"border-box" }}/>
              {customDate&&<div style={{ fontSize:"11px", color:C.blue, marginTop:"4px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>Week: {formatWeekLabel(activeWeek)}</div>}
            </div>
          )}
          {!useCustomDate&&existingWeeks.length>0&&(
            <select value={targetWeek} onChange={e=>setTargetWeek(e.target.value)} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.white, padding:"8px 12px", borderRadius:"6px", fontSize:"14px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", width:"100%", cursor:"pointer" }}>
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
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"15px", color:C.white }}>{t.name}</div>
              <div style={{ fontSize:"11px", color:C.muted }}>logged: ${(weekData[t.id]||0).toLocaleString()}</div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:"6px", flex:1 }}>
              <span style={{ color:C.green, fontSize:"16px", fontWeight:"800" }}>$</span>
              <input type="number" placeholder={weekData[t.id]||"0"} value={form[t.id]||""} onChange={e=>setForm(f=>({...f,[t.id]:e.target.value}))} style={{ background:C.card, border:`1px solid ${C.border}`, color:C.white, padding:"8px 10px", borderRadius:"6px", fontSize:"14px", fontFamily:"'Barlow Condensed',sans-serif", width:"100%", fontWeight:"700" }}/>
            </div>
          </div>
        ))}
        <button onClick={handleSave} disabled={saving} style={{ background:saving?"#333":C.green, border:"none", color:saving?"#666":C.black, padding:"13px", borderRadius:"6px", cursor:saving?"not-allowed":"pointer", fontSize:"13px", fontWeight:"700", letterSpacing:"2px", fontFamily:"'Barlow Condensed',sans-serif", width:"100%", textTransform:"uppercase" }}>{saving?"Saving...":"Save Upsells"}</button>
      </div>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"6px", padding:"16px 18px" }}>
        <Label color={C.green}>All-Time Totals</Label>
        {[...techs].sort((a,b)=>(allTimeUp[b.id]||0)-(allTimeUp[a.id]||0)).map((t,i)=>(
          <div key={t.id} style={{ display:"flex", justifyContent:"space-between", marginBottom:"8px" }}>
            <span style={{ fontSize:"13px", color:C.offWhite }}>{medal(i)} {t.name}</span>
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
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.gold}`, borderRadius:"6px", padding:"20px", display:"flex", flexDirection:"column", gap:"14px" }}>
      <Label color={C.gold}>Log 5-Star Reviews</Label>
      <div style={{ fontSize:"12px", color:C.muted }}>+{REVIEW_PTS} pts each · +{REVIEW_BONUS_PTS} bonus at 10+ · Log current or any past month</div>

      <div>
        <div style={{ fontSize:"11px", color:C.muted, marginBottom:"6px" }}>Select month</div>
        <select value={targetMonth} onChange={e=>{ setTargetMonth(e.target.value); setForm({}); }} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.white, padding:"8px 12px", borderRadius:"6px", fontSize:"14px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", width:"100%", cursor:"pointer" }}>
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
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"15px", color:C.white }}>{t.name}</div>
            <div style={{ fontSize:"11px", color:C.muted }}>logged: {monthData[t.id]||0} ⭐</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:"6px", flex:1 }}>
            <span style={{ color:C.gold, fontSize:"16px" }}>⭐</span>
            <input type="number" placeholder={monthData[t.id]||"0"} value={form[t.id]||""} onChange={e=>setForm(f=>({...f,[t.id]:e.target.value}))} style={{ background:C.card, border:`1px solid ${C.border}`, color:C.white, padding:"8px 10px", borderRadius:"6px", fontSize:"14px", fontFamily:"'Barlow Condensed',sans-serif", width:"100%", fontWeight:"700" }}/>
          </div>
        </div>
      ))}
      <button onClick={handleSave} disabled={saving} style={{ background:saving?"#333":C.gold, border:"none", color:saving?"#666":C.black, padding:"13px", borderRadius:"6px", cursor:saving?"not-allowed":"pointer", fontSize:"13px", fontWeight:"700", letterSpacing:"2px", fontFamily:"'Barlow Condensed',sans-serif", width:"100%", textTransform:"uppercase" }}>{saving?"Saving...":"Save Reviews"}</button>
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

  const inp = { background:C.cardLt, border:`1px solid ${C.border}`, color:C.white, padding:"10px 14px", borderRadius:"6px", fontSize:"14px", fontFamily:"'Barlow',sans-serif", width:"100%", boxSizing:"border-box", resize:"vertical", minHeight:"80px" };
  const selStyle = (val) => ({ background:C.cardLt, border:`1px solid ${C.border}`, color:val?C.white:C.muted, padding:"10px 14px", borderRadius:"6px", fontSize:"14px", fontFamily:"'Barlow',sans-serif", width:"100%", boxSizing:"border-box", cursor:"pointer" });

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
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.blue}`, borderRadius:"6px", padding:"16px 18px" }}>
            <Label color={C.blue}>📅 Thursday Ride-Along Schedule</Label>
            <div style={{ fontSize:"12px", color:C.muted, marginBottom:"14px" }}>Assign a tech to each Thursday. This is your weekly coaching schedule.</div>
            <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
              {thursdays.map(date=>{
                const assignedId = scheduleMap[date];
                const assignedTech = techs.find(t=>t.id===assignedId);
                const isPast = new Date(date) < new Date(new Date().toISOString().split("T")[0]);
                return (
                  <div key={date} style={{ background:C.cardLt, border:`1px solid ${assignedId?C.blue:C.border}`, borderRadius:"6px", padding:"12px 16px", display:"flex", alignItems:"center", gap:"12px", opacity:isPast?0.6:1 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"15px", color:C.white }}>{formatDate(date)}</div>
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
              <div style={{ background:`${C.blue}18`, border:`1px solid ${C.blue}44`, borderRadius:"6px", padding:"16px 18px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div>
                  <div style={{ fontSize:"10px", color:C.blue, letterSpacing:"2px", textTransform:"uppercase", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", marginBottom:"4px" }}>Next Ride-Along</div>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"22px", color:C.white }}>{tech?.name}</div>
                  <div style={{ fontSize:"13px", color:C.muted }}>{formatDate(next)}</div>
                </div>
                <button onClick={()=>{ setSelectedTech(scheduleMap[next]); setSelectedDate(next); setView("new"); }} style={{ background:C.blue, border:"none", color:C.white, padding:"10px 18px", borderRadius:"4px", cursor:"pointer", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"13px", letterSpacing:"1px" }}>START SESSION →</button>
              </div>
            );
          })()}
        </div>
      )}

      {/* NEW RIDE-ALONG FORM */}
      {view==="new"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.green}`, borderRadius:"6px", padding:"16px 18px", display:"flex", flexDirection:"column", gap:"12px" }}>
            <Label color={C.green}>✏️ New Ride-Along Session</Label>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px" }}>
              <select value={selectedTech} onChange={e=>setSelectedTech(e.target.value)} style={selStyle(selectedTech)}>
                <option value="">— Select Tech —</option>
                {techs.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:selectedDate?C.white:C.muted, padding:"10px 14px", borderRadius:"6px", fontSize:"14px", fontFamily:"'Barlow',sans-serif", width:"100%", boxSizing:"border-box" }}/>
            </div>
          </div>

          {CHECKLIST_SECTIONS.map(section=>(
            <div key={section.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderLeft:`3px solid ${C.blue}`, borderRadius:"6px", padding:"16px 18px" }}>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"18px", color:C.white, letterSpacing:"2px", marginBottom:"14px" }}>{section.icon} {section.title.toUpperCase()}</div>
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
                    <div style={{ fontSize:"13px", color:C.offWhite, lineHeight:"1.4", paddingTop:"2px" }}>{item.label}</div>
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
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderLeft:`3px solid ${C.gold}`, borderRadius:"6px", padding:"16px 18px" }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"18px", color:C.white, letterSpacing:"2px", marginBottom:"10px" }}>📝 GENERAL NOTES & COACHING POINTS</div>
            <textarea value={generalNotes} onChange={e=>setGeneralNotes(e.target.value)} placeholder="Overall session notes, things to work on, wins, action items for next ride-along..." style={{...inp, minHeight:"100px"}}/>
          </div>

          <button onClick={handleSaveRideAlong} disabled={saving||!selectedTech||!selectedDate} style={{ background:saving||!selectedTech||!selectedDate?"#333":C.green, border:"none", color:saving||!selectedTech||!selectedDate?"#666":C.black, padding:"14px", borderRadius:"6px", cursor:saving||!selectedTech||!selectedDate?"not-allowed":"pointer", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"14px", letterSpacing:"2px", textTransform:"uppercase" }}>
            {saving?"SAVING...":"SAVE RIDE-ALONG SESSION"}
          </button>
        </div>
      )}

      {/* HISTORY VIEW */}
      {view==="history"&&!viewDetail&&(
        <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.purple}`, borderRadius:"6px", padding:"16px 18px" }}>
            <Label color={C.purple}>📋 Ride-Along History</Label>
            {rideAlongs.length===0&&<div style={{ fontSize:"13px", color:C.muted }}>No ride-alongs logged yet.</div>}
            {[...rideAlongs].sort((a,b)=>b.date.localeCompare(a.date)).map(ra=>{
              const tech = techs.find(t=>t.id===ra.tech_id);
              const cl = ra.checklist ? JSON.parse(ra.checklist) : {};
              const passed = Object.values(cl).filter(v=>v==="✅").length;
              const failed = Object.values(cl).filter(v=>v==="❌").length;
              const total = Object.values(cl).length;
              return (
                <div key={ra.id} onClick={()=>setViewDetail(ra)} style={{ background:C.cardLt, border:`1px solid ${C.border}`, borderRadius:"6px", padding:"14px 16px", marginBottom:"8px", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"16px", color:C.white }}>{tech?.name}</div>
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
                <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${C.purple}`, borderRadius:"6px", padding:"16px 18px" }}>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"22px", color:C.white }}>{tech?.name}</div>
                  <div style={{ fontSize:"13px", color:C.muted }}>{formatDate(viewDetail.date)}</div>
                </div>
                {CHECKLIST_SECTIONS.map(section=>(
                  <div key={section.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderLeft:`3px solid ${C.blue}`, borderRadius:"6px", padding:"16px 18px" }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"16px", color:C.white, letterSpacing:"2px", marginBottom:"12px" }}>{section.icon} {section.title.toUpperCase()}</div>
                    {section.items.map(item=>{
                      const val = cl[section.id+"_"+item.id];
                      return (
                        <div key={item.id} style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"8px" }}>
                          <span style={{ fontSize:"14px", flexShrink:0 }}>{val||"—"}</span>
                          <span style={{ fontSize:"13px", color:C.offWhite }}>{item.label}</span>
                        </div>
                      );
                    })}
                    {section.notes?.map(note=>{
                      const val = notes[section.id+"_"+note.id];
                      if (!val) return null;
                      return (
                        <div key={note.id} style={{ marginTop:"8px", background:C.cardLt, borderRadius:"4px", padding:"10px 12px" }}>
                          <div style={{ fontSize:"11px", color:C.muted, marginBottom:"4px" }}>{note.label}</div>
                          <div style={{ fontSize:"13px", color:C.offWhite, lineHeight:"1.5", whiteSpace:"pre-wrap" }}>{val}</div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                {viewDetail.general_notes&&(
                  <div style={{ background:C.card, border:`1px solid ${C.border}`, borderLeft:`3px solid ${C.gold}`, borderRadius:"6px", padding:"16px 18px" }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"16px", color:C.white, letterSpacing:"2px", marginBottom:"10px" }}>📝 GENERAL NOTES</div>
                    <div style={{ fontSize:"13px", color:C.offWhite, lineHeight:"1.6", whiteSpace:"pre-wrap" }}>{viewDetail.general_notes}</div>
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
function AdminPanel({ techs, upsells, switchovers, reviews, rideAlongs, schedules, onLogout, refreshAll }) {
  const [tab, setTab] = useState("upsells");
  const [awardForm, setAwardForm] = useState({techId:"",badgeId:""});
  const [addForm, setAddForm] = useState({name:"",pin:"",avatar:"",start_date:""});
  const [upsellForm, setUpsellForm] = useState({});
  const [swForm, setSwForm] = useState({techId:"",planId:""});
  const [reviewForm, setReviewForm] = useState({});
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);

  const showToast=(msg,ok=true)=>{ setToast({msg,ok}); setTimeout(()=>setToast(null),3000); };

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

  const inp={ background:C.card, border:`1px solid ${C.border}`, color:C.white, padding:"10px 14px", borderRadius:"6px", fontSize:"14px", fontFamily:"'Barlow',sans-serif", width:"100%", boxSizing:"border-box" };
  const sel=(val)=>({...inp, color:val?C.white:C.muted});
  const btn=(color)=>({ background:saving?"#333":color||C.blue, border:"none", color:C.white, padding:"13px", borderRadius:"6px", cursor:saving?"not-allowed":"pointer", fontSize:"13px", fontWeight:"700", letterSpacing:"2px", fontFamily:"'Barlow Condensed',sans-serif", width:"100%", textTransform:"uppercase" });

  return (
    <div style={{ minHeight:"100vh", background:C.dark }}>
      <style>{GS}</style>
      <Header title="Admin Panel" subtitle="Skylo Standard Board" right={<LogoutBtn onLogout={onLogout}/>}/>
      <TabBar tabs={[["upsells","Upsells"],["reviews","⭐ Reviews"],["switchovers","Converts"],["award","Award Badge"],["add","Add Tech"],["manage","Manage"],["delete","🗑️ Delete"],["journey","🗺️ Journey"],["incentive","🎁 Rewards"],["ridealong","🚗 Ride-Alongs"]]} active={tab} setActive={setTab} accent={C.green}/>
      <div style={{ padding:"20px", maxWidth:"700px", margin:"0 auto" }}>

        {tab==="upsells"&&(
          <AdminUpsellEntry techs={techs} upsells={upsells} saving={saving} setSaving={setSaving} refreshAll={refreshAll} showToast={showToast} allTimeUp={allTimeUp}/>
        )}

        {tab==="reviews"&&(
          <AdminReviewEntry techs={techs} reviews={reviews} saving={saving} setSaving={setSaving} refreshAll={refreshAll} showToast={showToast}/>
        )}
        {tab==="switchovers"&&(
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"6px", padding:"20px", display:"flex", flexDirection:"column", gap:"12px" }}>
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

        {tab==="award"&&(
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"6px", padding:"20px", display:"flex", flexDirection:"column", gap:"12px" }}>
            <Label color={C.blue}>Award a Badge</Label>
            <select value={awardForm.techId} onChange={e=>setAwardForm(f=>({...f,techId:e.target.value}))} style={sel(awardForm.techId)}>
              <option value="">— Select Tech —</option>
              {techs.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={awardForm.badgeId} onChange={e=>setAwardForm(f=>({...f,badgeId:e.target.value}))} style={sel(awardForm.badgeId)}>
              <option value="">— Select Badge —</option>
              {BADGE_DEFS.map(b=><option key={b.id} value={b.id}>{b.icon} {b.name} (+{b.pts} pts)</option>)}
            </select>
            <button onClick={awardBadge} disabled={saving} style={btn(C.blue)}>{saving?"Saving...":"Award Badge"}</button>
          </div>
        )}

        {tab==="add"&&(
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"6px", padding:"20px", display:"flex", flexDirection:"column", gap:"12px" }}>
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
              <div key={t.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"6px", padding:"16px 18px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"10px" }}>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"17px", color:C.white }}>{t.name}</div>
                  <span style={{ fontSize:"12px", color:C.muted, fontFamily:"'Barlow Condensed',sans-serif" }}>PIN: {t.pin}</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"10px" }}>
                  <span style={{ fontSize:"12px", color:C.muted }}>Start date:</span>
                  <input type="date" defaultValue={t.start_date||""} onBlur={e=>updateStartDate(t.id,e.target.value)} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.white, padding:"4px 8px", borderRadius:"4px", fontSize:"12px", fontFamily:"'Barlow Condensed',sans-serif" }}/>
                  {t.start_date&&<span style={{ fontSize:"12px", color:C.blue, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>{formatTenure(t.start_date)}</span>}
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:"5px" }}>
                  {t.badges.map(bid=>{ const b=BADGE_MAP[bid]; return b?(
                    <span key={bid} style={{ background:`${C.blue}18`, border:`1px solid ${C.blue}44`, borderRadius:"3px", padding:"3px 8px", fontSize:"12px", display:"inline-flex", alignItems:"center", gap:"4px" }}>
                      <span>{b.icon}</span><span style={{ color:C.white, fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700" }}>{b.name}</span>
                      <button onClick={()=>revokeBadge(t.id,bid)} style={{ background:"none", border:"none", color:"#ff4444", cursor:"pointer", fontSize:"13px", lineHeight:1, padding:"0 0 0 2px" }}>×</button>
                    </span>
                  ):null; })}
                </div>
              </div>
            ))}
          </div>
        )}


        {tab==="delete"&&(
          <DeleteTab techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews} saving={saving} setSaving={setSaving} refreshAll={refreshAll} showToast={showToast}/>
        )}
        {tab==="journey"&&(
          <div>
            <div style={{ fontSize:"13px", color:C.muted, marginBottom:"16px" }}>Tap any card to expand full breakdown.</div>
            <JourneyBoard techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews}/>
          </div>
        )}
        {tab==="incentive"&&(
          <div>
            <div style={{ fontSize:"13px", color:C.muted, marginBottom:"16px" }}>Team rewards overview — all tiers and prizes.</div>
            <IncentiveBoard techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews} currentId={null}/>
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
        <div style={{ position:"fixed", bottom:"24px", left:"50%", transform:"translateX(-50%)", background:toast.ok?C.green:"#ff4444", color:toast.ok?C.black:C.white, padding:"12px 24px", borderRadius:"6px", fontSize:"14px", fontWeight:"700", zIndex:999, whiteSpace:"nowrap", fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:"1px" }}>
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
  const [rideAlongs, setRideAlongs] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(null);

  const loadAll = useCallback(async () => {
    try {
      const [t,u,s,r,ra,sch] = await Promise.all([
        sb("techs?select=*&order=name"),
        sb("upsells?select=*"),
        sb("switchovers?select=*"),
        sb("reviews?select=*"),
        sb("ride_alongs?select=*&order=date.desc").catch(()=>[]),
        sb("ride_along_schedule?select=*").catch(()=>[]),
      ]);
      setTechs(t||[]); setUpsells(u||[]); setSwitchovers(s||[]); setReviews(r||[]);
      setRideAlongs(ra||[]); setSchedules(sch||[]);
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
    <div style={{ minHeight:"100vh", background:C.dark, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:"16px" }}>
      <style>{GS}</style>
      <Logo h={60}/>
      <div style={{ fontFamily:"'Barlow Condensed',sans-serif", color:C.blue, letterSpacing:"4px", fontSize:"12px", fontWeight:"700" }}>LOADING...</div>
    </div>
  );

  if (dbError) return (
    <div style={{ minHeight:"100vh", background:C.dark, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:"16px", padding:"24px", textAlign:"center" }}>
      <style>{GS}</style>
      <Logo h={60}/>
      <div style={{ color:"#ff4444", fontSize:"13px", maxWidth:"560px" }}>
        <strong>Database setup needed.</strong> Run this SQL in Supabase → SQL Editor:<br/><br/>
        <code style={{ background:C.card, padding:"12px", borderRadius:"6px", fontSize:"11px", display:"block", textAlign:"left", whiteSpace:"pre", color:C.offWhite }}>
{`alter table techs add column if not exists start_date date;

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  tech_id uuid references techs(id),
  month_key text, count integer default 0,
  created_at timestamptz default now()
);
alter table reviews enable row level security;
drop policy if exists "public access" on reviews;
create policy "public access" on reviews for all using (true) with check (true);`}
        </code><br/>
        <button onClick={()=>{setDbError(null);setLoading(true);loadAll().then(()=>setLoading(false));}} style={{ background:C.blue, border:"none", color:C.white, padding:"10px 24px", borderRadius:"6px", cursor:"pointer", fontFamily:"'Barlow Condensed',sans-serif", fontSize:"14px", fontWeight:"700", letterSpacing:"2px" }}>RETRY</button>
      </div>
    </div>
  );

  if (!user) return (
    <div style={{ minHeight:"100vh", background:C.dark, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"48px" }}>
      <style>{GS}</style>
      <div style={{ textAlign:"center" }}>
        <Logo h={80}/>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"42px", color:C.white, letterSpacing:"6px", marginTop:"20px", lineHeight:1 }}>THE STANDARD</div>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"42px", color:C.blue, letterSpacing:"6px", lineHeight:1 }}>BOARD</div>
        <div style={{ fontSize:"13px", color:C.muted, letterSpacing:"3px", marginTop:"12px", textTransform:"uppercase" }}>Enter your PIN</div>
      </div>
      <PinPad onSubmit={handlePin}/>
    </div>
  );

  if (user.type==="admin") return (
    <AdminPanel techs={techs} setTechs={setTechs} upsells={upsells} setUpsells={setUpsells}
      switchovers={switchovers} setSwitchovers={setSwitchovers} reviews={reviews} setReviews={setReviews}
      rideAlongs={rideAlongs} schedules={schedules}
      onLogout={()=>setUser(null)} refreshAll={loadAll}/>
  );
  if (user.type==="tech"&&currentTech) return (
    <TechDashboard tech={currentTech} techs={techs} upsells={upsells} switchovers={switchovers}
      reviews={reviews} onLogout={()=>setUser(null)}/>
  );
  return null;
}
