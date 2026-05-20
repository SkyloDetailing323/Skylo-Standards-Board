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
  const wkData = byWeek[wk]||{};
  const allTime = {};
  upsells.forEach(u=>{ allTime[u.tech_id]=(allTime[u.tech_id]||0)+u.amount; });
  const ranked = [...techs].map(t=>({...t,week:wkData[t.id]||0,all:allTime[t.id]||0})).sort((a,b)=>b.week-a.week);
  const top = ranked[0]?.week||1;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"24px" }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"6px", overflow:"hidden" }}>
        <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <Label color={C.green}>💰 All-Time Totals</Label>
        </div>
        <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"10px" }}>
          {[...techs].sort((a,b)=>(allTime[b.id]||0)-(allTime[a.id]||0)).map((t,i)=>{
            const amt=allTime[t.id]||0; const pct=Math.round((amt/(Math.max(...techs.map(x=>allTime[x.id]||0))||1))*100);
            return (
              <div key={t.id}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"5px" }}>
                  <span style={{ fontSize:"13px", fontWeight:"600", color:t.id===currentId?C.blue:C.offWhite }}>{medal(i)} {t.name}{t.id===currentId?" — YOU":""}</span>
                  <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"14px", color:C.white }}>${amt.toLocaleString()}</span>
                </div>
                <Bar pct={pct} color={C.green}/>
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <Label>This Week · {formatWeekLabel(wk)}</Label>
        <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
          {ranked.map((t,idx)=>{
            const isMe=t.id===currentId; const pct=top>0?Math.round((t.week/top)*100):0;
            return (
              <div key={t.id} style={{ background:isMe?`${C.blue}18`:C.card, border:`1px solid ${isMe?C.blue:C.border}`, borderRadius:"6px", padding:"14px 18px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"10px" }}>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:idx<3?"22px":"14px", color:C.muted, width:"28px", textAlign:"center" }}>{medal(idx)}</div>
                  <div style={{ width:"38px", height:"38px", borderRadius:"50%", background:`${C.blue}22`, border:`1px solid ${C.blue}44`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Barlow Condensed',sans-serif", fontSize:"12px", fontWeight:"800", color:C.blue, flexShrink:0 }}>{t.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"16px", color:C.white }}>{t.name}{isMe&&<span style={{ color:C.blue, fontSize:"11px", letterSpacing:"1px", marginLeft:"6px" }}>YOU</span>}</div>
                    <div style={{ fontSize:"11px", color:C.muted }}>All-time ${t.all.toLocaleString()} · {Math.round(t.all*UPSELL_PTS_PER_DOLLAR).toLocaleString()} pts</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"24px", color:t.week>0?C.white:C.border }}>${t.week.toLocaleString()}</div>
                    <div style={{ fontSize:"11px", color:C.green }}>+{Math.round(t.week*UPSELL_PTS_PER_DOLLAR)} pts</div>
                  </div>
                </div>
                <Bar pct={pct} color={C.green}/>
              </div>
            );
          })}
        </div>
      </div>
      {allWeeks.length>0&&(
        <div>
          <Label>Weekly History</Label>
          <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
            {allWeeks.map(w=>{
              const d=byWeek[w]||{}; const rows=[...techs].map(t=>({...t,amt:d[t.id]||0})).filter(t=>t.amt>0).sort((a,b)=>b.amt-a.amt); const total=rows.reduce((s,t)=>s+t.amt,0);
              return (
                <div key={w} style={{ background:C.card, border:`1px solid ${w===wk?C.blue:C.border}`, borderRadius:"6px", overflow:"hidden" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 16px", borderBottom:`1px solid ${C.border}`, background:C.cardLt }}>
                    <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"13px", color:C.white }}>{formatWeekLabel(w)}{w===wk&&<Pill color={C.blue}> CURRENT</Pill>}</span>
                    <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"13px", color:C.green }}>${total.toLocaleString()}</span>
                  </div>
                  <div style={{ padding:"10px 16px", display:"flex", flexDirection:"column", gap:"4px" }}>
                    {rows.map((t,i)=>(
                      <div key={t.id} style={{ display:"flex", justifyContent:"space-between" }}>
                        <span style={{ fontSize:"13px", color:C.offWhite }}>{medal(i)} {t.name}</span>
                        <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"13px", color:C.white }}>${t.amt.toLocaleString()}</span>
                      </div>
                    ))}
                    {rows.length===0&&<span style={{ fontSize:"12px", color:C.muted }}>No data</span>}
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
  const mData = byMonth[mk]||{};
  const allTime = {};
  reviews.forEach(r=>{ allTime[r.tech_id]=(allTime[r.tech_id]||0)+r.count; });
  const ranked = [...techs].map(t=>({...t,month:mData[t.id]||0,all:allTime[t.id]||0})).sort((a,b)=>b.month-a.month);
  const top = ranked[0]?.month||1;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"24px" }}>
      <div style={{ background:`${C.gold}18`, border:`1px solid ${C.gold}44`, borderRadius:"6px", padding:"14px 18px", display:"flex", gap:"24px", flexWrap:"wrap" }}>
        <div><span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"22px", color:C.gold }}>+{REVIEW_PTS}</span><span style={{ fontSize:"12px", color:C.muted, marginLeft:"6px" }}>pts per review</span></div>
        <div><span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"22px", color:C.gold }}>+{REVIEW_BONUS_PTS}</span><span style={{ fontSize:"12px", color:C.muted, marginLeft:"6px" }}>bonus at 10+ in a month</span></div>
      </div>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"6px", overflow:"hidden" }}>
        <div style={{ padding:"14px 18px", borderBottom:`1px solid ${C.border}` }}><Label color={C.gold}>⭐ All-Time Reviews</Label></div>
        <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:"10px" }}>
          {[...techs].sort((a,b)=>(allTime[b.id]||0)-(allTime[a.id]||0)).map((t,i)=>{
            const cnt=allTime[t.id]||0; const pct=Math.round((cnt/(Math.max(...techs.map(x=>allTime[x.id]||0))||1))*100);
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
      <div>
        <Label>This Month · {formatMonthLabel(mk)}</Label>
        <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
          {ranked.map((t,idx)=>{
            const isMe=t.id===currentId; const pct=top>0?Math.round((t.month/top)*100):0; const bonus=t.month>=10;
            return (
              <div key={t.id} style={{ background:isMe?`${C.blue}18`:C.card, border:`1px solid ${isMe?C.blue:C.border}`, borderRadius:"6px", padding:"14px 18px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"10px" }}>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:idx<3?"22px":"14px", color:C.muted, width:"28px", textAlign:"center" }}>{medal(idx)}</div>
                  <div style={{ width:"38px", height:"38px", borderRadius:"50%", background:`${C.blue}22`, border:`1px solid ${C.blue}44`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Barlow Condensed',sans-serif", fontSize:"12px", fontWeight:"800", color:C.blue, flexShrink:0 }}>{t.avatar}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", fontSize:"16px", color:C.white }}>{t.name}{isMe&&<span style={{ color:C.blue, fontSize:"11px", marginLeft:"6px" }}>YOU</span>}</div>
                    <div style={{ fontSize:"11px", color:C.muted }}>All-time: {t.all} reviews</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"900", fontSize:"24px", color:t.month>0?C.white:C.border }}>{t.month}</div>
                    <div style={{ fontSize:"11px", color:C.gold }}>+{(t.month*REVIEW_PTS)+(bonus?REVIEW_BONUS_PTS:0)} pts{bonus?" 🔥":""}</div>
                  </div>
                </div>
                <Bar pct={pct} color={C.gold}/>
                {bonus&&<div style={{ marginTop:"8px" }}><Pill color={C.gold}>🔥 10+ bonus unlocked</Pill></div>}
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
      <TabBar tabs={[["overview","Overview"],["badges","Badges"],["upsells","Upsells"],["switchovers","Converts"],["reviews","⭐ Reviews"],["total","🏆 Total"],["journey","🗺️ Journey"]]} active={tab} setActive={setTab}/>
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
      </div>
    </div>
  );
}

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────
function AdminPanel({ techs, upsells, switchovers, reviews, onLogout, refreshAll }) {
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
      <TabBar tabs={[["upsells","Upsells"],["reviews","⭐ Reviews"],["switchovers","Converts"],["award","Award Badge"],["add","Add Tech"],["manage","Manage"],["journey","🗺️ Journey"]]} active={tab} setActive={setTab} accent={C.green}/>
      <div style={{ padding:"20px", maxWidth:"700px", margin:"0 auto" }}>

        {tab==="upsells"&&(
          <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"6px", padding:"20px", display:"flex", flexDirection:"column", gap:"14px" }}>
              <Label color={C.green}>Enter This Week · {formatWeekLabel(wk)}</Label>
              <div style={{ fontSize:"12px", color:C.muted }}>$2 = 1 point</div>
              {techs.map(t=>(
                <div key={t.id} style={{ display:"flex", alignItems:"center", gap:"12px" }}>
                  <div style={{ width:"150px" }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"15px", color:C.white }}>{t.name}</div>
                    <div style={{ fontSize:"11px", color:C.muted }}>current: ${(wkUp[t.id]||0).toLocaleString()}</div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:"6px", flex:1 }}>
                    <span style={{ color:C.green, fontSize:"16px", fontWeight:"800" }}>$</span>
                    <input type="number" placeholder={wkUp[t.id]||"0"} value={upsellForm[t.id]||""} onChange={e=>setUpsellForm(f=>({...f,[t.id]:e.target.value}))} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.white, padding:"8px 10px", borderRadius:"6px", fontSize:"14px", fontFamily:"'Barlow Condensed',sans-serif", width:"100%", fontWeight:"700" }}/>
                  </div>
                </div>
              ))}
              <button onClick={saveUpsells} disabled={saving} style={btn(C.green)}>{saving?"Saving...":"Save This Week"}</button>
            </div>
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"6px", padding:"16px 18px" }}>
              <Label color={C.green}>All-Time Upsell Totals</Label>
              {[...techs].sort((a,b)=>(allTimeUp[b.id]||0)-(allTimeUp[a.id]||0)).map((t,i)=>(
                <div key={t.id} style={{ display:"flex", justifyContent:"space-between", marginBottom:"8px" }}>
                  <span style={{ fontSize:"13px", color:C.offWhite }}>{medal(i)} {t.name}</span>
                  <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"800", color:C.green }}>${(allTimeUp[t.id]||0).toLocaleString()} · {Math.round((allTimeUp[t.id]||0)*UPSELL_PTS_PER_DOLLAR)} pts</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab==="reviews"&&(
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:"6px", padding:"20px", display:"flex", flexDirection:"column", gap:"14px" }}>
            <Label color={C.gold}>Log 5-Star Reviews · {formatMonthLabel(mk)}</Label>
            <div style={{ fontSize:"12px", color:C.muted }}>+{REVIEW_PTS} pts each · +{REVIEW_BONUS_PTS} bonus at 10+ per month</div>
            {techs.map(t=>(
              <div key={t.id} style={{ display:"flex", alignItems:"center", gap:"12px" }}>
                <div style={{ width:"150px" }}>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:"700", fontSize:"15px", color:C.white }}>{t.name}</div>
                  <div style={{ fontSize:"11px", color:C.muted }}>this month: {mkRev[t.id]||0} ⭐</div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:"6px", flex:1 }}>
                  <span style={{ color:C.gold, fontSize:"16px" }}>⭐</span>
                  <input type="number" placeholder={mkRev[t.id]||"0"} value={reviewForm[t.id]||""} onChange={e=>setReviewForm(f=>({...f,[t.id]:e.target.value}))} style={{ background:C.cardLt, border:`1px solid ${C.border}`, color:C.white, padding:"8px 10px", borderRadius:"6px", fontSize:"14px", fontFamily:"'Barlow Condensed',sans-serif", width:"100%", fontWeight:"700" }}/>
                </div>
              </div>
            ))}
            <button onClick={saveReviews} disabled={saving} style={btn(C.gold)}>{saving?"Saving...":"Save This Month's Reviews"}</button>
          </div>
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

        {tab==="journey"&&(
          <div>
            <div style={{ fontSize:"13px", color:C.muted, marginBottom:"16px" }}>Tap any card to expand full breakdown.</div>
            <JourneyBoard techs={techs} upsells={upsells} switchovers={switchovers} reviews={reviews}/>
          </div>
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
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(null);

  const loadAll = useCallback(async () => {
    try {
      const [t,u,s,r] = await Promise.all([sb("techs?select=*&order=name"),sb("upsells?select=*"),sb("switchovers?select=*"),sb("reviews?select=*")]);
      setTechs(t||[]); setUpsells(u||[]); setSwitchovers(s||[]); setReviews(r||[]);
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
      onLogout={()=>setUser(null)} refreshAll={loadAll}/>
  );
  if (user.type==="tech"&&currentTech) return (
    <TechDashboard tech={currentTech} techs={techs} upsells={upsells} switchovers={switchovers}
      reviews={reviews} onLogout={()=>setUser(null)}/>
  );
  return null;
}
